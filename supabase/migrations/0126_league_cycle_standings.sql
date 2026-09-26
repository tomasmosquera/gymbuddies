-- ============================================================================
-- Full final standings of every settled League cycle.
--
-- Until now a completed cycle only kept league_cycle_payouts — one row per
-- place that actually received money — so the app could show the podium but
-- not who finished 4th, 5th... nor who fell into the relegation zone.
-- league_cycle_standings keeps EVERY eligible member's final place, their
-- completed/failed days, the prize they were paid, and whether they were
-- relegated (and what that cost them).
--
-- Written by evaluate_due_league_cycle at settlement (same ranking it already
-- computed; the only change is that it no longer stops scanning after the
-- podium). Cycles settled before this migration have no standings rows —
-- there are none in production yet — and the app falls back to the payouts
-- for any cycle without them. liquidate_group_now (the manual "cash everyone
-- out" tool) still writes only payouts, so cycles it closes use that fallback.
-- ============================================================================

create table league_cycle_standings (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references league_cycles (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  place int not null check (place >= 1),
  completed_days int not null default 0,
  failed_days int not null default 0,
  prize_amount numeric(12, 2) not null default 0,
  relegated boolean not null default false,
  descenso_amount numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (cycle_id, user_id)
);

alter table league_cycle_standings enable row level security;

create policy league_cycle_standings_select on league_cycle_standings for select
  using (exists (select 1 from league_cycles c where c.id = league_cycle_standings.cycle_id and is_group_member(c.group_id)));

revoke insert, update, delete on league_cycle_standings from authenticated;

-- ---- who already saw a cycle's end-of-cycle results modal --------------------------
-- The app shows that modal once per person per cycle, the first time they open it
-- after the cycle settled. The row is what makes "once" hold across restarts and
-- devices. A member may only read and write THEIR OWN row, and only for a cycle of
-- a group they belong to.
create table league_cycle_results_seen (
  cycle_id uuid not null references league_cycles (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (cycle_id, user_id)
);

alter table league_cycle_results_seen enable row level security;

create policy league_cycle_results_seen_select on league_cycle_results_seen for select
  using (user_id = auth.uid());
create policy league_cycle_results_seen_insert on league_cycle_results_seen for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from league_cycles c where c.id = league_cycle_results_seen.cycle_id and is_group_member(c.group_id))
  );

revoke update, delete on league_cycle_results_seen from authenticated;

-- ---- evaluate_due_league_cycle: reproduces 0125; also records the full standings ----
create or replace function evaluate_due_league_cycle(p_group_id uuid, p_as_of_week_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_prize_len int;
  v_pool_total numeric(12, 2);
  v_pool_for_league numeric(12, 2);
  v_total_distributed numeric(12, 2) := 0;
  v_rank_group record;
  v_split_idx int;
  v_merged_percent numeric(5, 2);
  v_winner_user_id uuid;
  v_winner_amount numeric(12, 2);
  v_wtx_id uuid;
  v_active_count int;
  v_delta_cents bigint;
  v_base_cents bigint;
  v_remainder_cents int;
  v_sign int;
  v_member_idx int := 0;
  v_member record;
  v_eligible_count int;
  v_descenso_active boolean;
  v_descenso_cutoff int;
  v_total_descenso numeric(12, 2) := 0;
  v_amount_to_fund numeric(12, 2);
  v_descenso_user_id uuid;
  v_descenso_user_ids uuid[];
  v_winner_user_ids uuid[];
  v_winner_places int[];
  v_winner_percents numeric[];
  v_winner_idx int;
  v_cycle_start_date date;
  v_cycle_end_date date;
  v_std_idx int;
  v_is_relegated boolean;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.payout_mode = 'cooperative' then
    return;
  end if;

  select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running' for update;
  if not found then
    return;
  end if;

  -- Dates in the GROUP's timezone (a bare ::date would use the session's UTC).
  v_cycle_start_date := (v_cycle.started_at at time zone v_group.timezone)::date;
  v_cycle_end_date := (v_cycle.ends_at at time zone v_group.timezone)::date;
  if v_cycle_end_date > p_as_of_week_end then
    return;
  end if;

  perform 1 from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge')
    for update;

  select coalesce(sum(balance), 0) into v_pool_total
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

  v_pool_for_league := greatest(v_pool_total * v_cycle.league_share_percent / 100, 0);
  v_prize_len := jsonb_array_length(v_cycle.prize_splits);

  select count(*) into v_eligible_count
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
  v_descenso_active := v_group.payout_mode = 'league' and v_group.descenso_rank_count > 0;
  v_descenso_cutoff := case when v_descenso_active
    then greatest(v_eligible_count - v_group.descenso_rank_count, 0)
    else null
  end;

  for v_rank_group in
    with per_user as (
      select wer.user_id, sum(wer.completed_days) as completed, sum(wer.failed_days) as failed
        from weekly_evaluation_results wer
        join weekly_evaluation_runs wr on wr.id = wer.run_id
        where wer.group_id = p_group_id
          and wr.week_start_date >= v_cycle_start_date
          and wr.week_end_date <= v_cycle_end_date
        group by wer.user_id
    ),
    per_user_minutes as (
      select c.user_id, sum(c.workout_minutes) as minutes
        from checkins c
        where c.group_id = p_group_id
          and c.checkin_date >= v_cycle_start_date
          and c.checkin_date <= v_cycle_end_date
        group by c.user_id
    ),
    eligible as (
      select gm.user_id from group_members gm
        where gm.group_id = p_group_id and gm.status in ('active', 'needs_recharge')
    ),
    ranked as (
      select
        e.user_id,
        coalesce(pu.completed, 0)::int as completed,
        coalesce(pu.failed, 0)::int as failed,
        rank() over (
          order by
            coalesce(pu.completed - pu.failed, -999999) desc,
            case when v_group.require_checkout_photo then coalesce(pum.minutes, 0) else 0 end desc
        ) as place
        from eligible e
        left join per_user pu on pu.user_id = e.user_id
        left join per_user_minutes pum on pum.user_id = e.user_id
    )
    select place, array_agg(user_id order by user_id) as users,
           array_agg(completed order by user_id) as completeds,
           array_agg(failed order by user_id) as faileds,
           count(*)::int as k
      from ranked
      group by place
      order by place
  loop
    -- Every rank group is visited (no early exit): the FULL final standings are
    -- recorded, not just the podium and the relegation zone.
    v_is_relegated := v_descenso_active and v_rank_group.place > v_descenso_cutoff;
    for v_std_idx in 1 .. array_length(v_rank_group.users, 1) loop
      insert into league_cycle_standings (
        cycle_id, user_id, place, completed_days, failed_days, relegated, descenso_amount
      ) values (
        v_cycle.id, v_rank_group.users[v_std_idx], v_rank_group.place,
        v_rank_group.completeds[v_std_idx], v_rank_group.faileds[v_std_idx],
        v_is_relegated, case when v_is_relegated then v_group.descenso_penalty_amount else 0 end
      );
    end loop;

    -- Prize winners: buffer, don't pay yet — the amount depends on the pool
    -- after descenso is folded in below, which isn't known until the scan
    -- finishes.
    if v_rank_group.place <= v_prize_len then
      v_merged_percent := 0;
      for v_split_idx in v_rank_group.place .. least(v_rank_group.place + v_rank_group.k - 1, v_prize_len) loop
        v_merged_percent := v_merged_percent + (v_cycle.prize_splits ->> (v_split_idx - 1))::numeric;
      end loop;
      v_merged_percent := v_merged_percent / v_rank_group.k;

      foreach v_winner_user_id in array v_rank_group.users loop
        v_winner_user_ids := array_append(v_winner_user_ids, v_winner_user_id);
        v_winner_places := array_append(v_winner_places, v_rank_group.place);
        v_winner_percents := array_append(v_winner_percents, v_merged_percent);
      end loop;
    end if;

    -- Descenso: the bottom descenso_rank_count places. Charged immediately
    -- (fixed amount, doesn't depend on the pool) and unconditionally even at
    -- $0, so there's always an audit trail of who was marked whether or not
    -- it actually cost them anything.
    if v_descenso_active and v_rank_group.place > v_descenso_cutoff then
      foreach v_descenso_user_id in array v_rank_group.users loop
        insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
          values (
            p_group_id, v_descenso_user_id, 'penalty', -v_group.descenso_penalty_amount, 'confirmed',
            format('descenso de liga: puesto %s', v_rank_group.place), now()
          );
        v_total_descenso := v_total_descenso + v_group.descenso_penalty_amount;
        v_descenso_user_ids := array_append(v_descenso_user_ids, v_descenso_user_id);
      end loop;
    end if;
  end loop;

  -- Boost this cycle's pool with whatever descenso collected, then resolve
  -- the buffered prize winners against the now-boosted pool.
  v_pool_for_league := v_pool_for_league + v_total_descenso;

  for v_winner_idx in 1 .. coalesce(array_length(v_winner_user_ids, 1), 0) loop
    v_winner_amount := round(v_pool_for_league * v_winner_percents[v_winner_idx] / 100, 2);
    if v_winner_amount > 0 then
      insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
        values (
          p_group_id, v_winner_user_ids[v_winner_idx], 'payout', v_winner_amount, 'confirmed',
          format('premio de liga: puesto %s (%s%%)', v_winner_places[v_winner_idx], v_winner_percents[v_winner_idx]), now()
        ) returning id into v_wtx_id;

      insert into league_cycle_payouts (cycle_id, user_id, place, share_percent, amount, wallet_transaction_id)
        values (
          v_cycle.id, v_winner_user_ids[v_winner_idx], v_winner_places[v_winner_idx],
          v_winner_percents[v_winner_idx], v_winner_amount, v_wtx_id
        );

      v_total_distributed := v_total_distributed + v_winner_amount;

      update league_cycle_standings
        set prize_amount = v_winner_amount
        where cycle_id = v_cycle.id and user_id = v_winner_user_ids[v_winner_idx];
    end if;
  end loop;

  -- Fund the prize: spread the cost equally across every currently active
  -- member, including the winners themselves — exactly how a shared pot
  -- works (everyone funds the prize equally, winners additionally collect).
  -- Descenso money already collected funds part (or all) of it, so only the
  -- remainder gets spread across the group — this is what keeps relegated
  -- members from being charged twice and non-relegated members' funding
  -- share unaffected by descenso.
  if v_total_distributed > 0 then
    v_amount_to_fund := greatest(v_total_distributed - v_total_descenso, 0);

    if v_amount_to_fund > 0 then
      select count(*) into v_active_count
        from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

      v_delta_cents := round(-v_amount_to_fund * 100);
      v_base_cents := trunc(v_delta_cents::numeric / v_active_count)::bigint;
      v_remainder_cents := (v_delta_cents - v_base_cents * v_active_count)::int;
      v_sign := sign(v_remainder_cents)::int;

      for v_member in
        select user_id from group_members
          where group_id = p_group_id and status in ('active', 'needs_recharge')
          order by joined_at asc
      loop
        v_member_idx := v_member_idx + 1;
        insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
          values (
            p_group_id, v_member.user_id, 'payout',
            (v_base_cents + case when v_member_idx <= abs(v_remainder_cents) then v_sign else 0 end) / 100.0,
            'confirmed', 'aporte al premio del ciclo de liga', now()
          );
      end loop;
    end if;
  end if;

  update league_cycles
    set status = 'completed', completed_at = now(), pool_at_payout = v_pool_for_league
    where id = v_cycle.id;

  perform send_push_notification(
    (select array_agg(user_id) from group_members where group_id = p_group_id and status in ('active', 'needs_recharge')),
    'Ciclo de Liga terminado', 'Se repartió el premio del ciclo de Liga — revisa Reglas para ver los resultados.',
    p_group_id => p_group_id, p_category => 'money'
  );

  if v_descenso_user_ids is not null and array_length(v_descenso_user_ids, 1) > 0 then
    perform send_push_notification(
      v_descenso_user_ids,
      'Zona de descenso',
      case
        when v_group.descenso_penalty_amount > 0 then
          format('Quedaste entre los últimos del ciclo de liga y se te cobró %s de multa.', v_group.descenso_penalty_amount)
        else
          'Quedaste entre los últimos del ciclo de liga.'
      end,
      p_group_id => p_group_id, p_category => 'money'
    );
  end if;

  if v_group.league_auto_renew then
    -- The next cycle begins right away, on the Monday that follows the week just closed.
    perform start_league_cycle_at(p_group_id, ((p_as_of_week_end + 1)::timestamp) at time zone v_group.timezone);
  elsif v_group.admin_id is not null then
    perform send_push_notification(
      array[v_group.admin_id], 'Inicia un nuevo ciclo de Liga',
      'El ciclo anterior terminó y el premio ya se repartió. Puedes iniciar el próximo ciclo desde Reglas.',
      p_group_id => p_group_id, p_category => 'admin_actions'
    );
  end if;
end;
$$;
