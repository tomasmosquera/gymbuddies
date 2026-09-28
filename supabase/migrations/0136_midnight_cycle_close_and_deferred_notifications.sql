-- ============================================================================
-- Split "close the week / close the league cycle" (computation) from
-- "tell people about it" (push notification).
--
-- Until now both happened atomically at Monday 8am group-local time: a
-- single hourly cron tick gated on local hour = 8 ran run_weekly_evaluation,
-- which computed the week's attendance/penalties AND (inline, same
-- transaction) called evaluate_due_league_cycle, which ranked and closed a
-- due league cycle, paid out, possibly auto-renewed, AND sent every push
-- notification for all of that.
--
-- Now: the COMPUTATION (weekly results, penalties, cycle ranking/freezing/
-- payout/auto-renew) moves to local midnight (hour = 0), so a user opening
-- the app right after midnight already sees the closed cycle's results and
-- the new cycle running. The NOTIFICATIONS (weekly result push, low-balance
-- push, cycle-closed push, descenso push, "start a new cycle" admin push)
-- are no longer sent inline — they're picked up by a separate hourly-ticked
-- function gated on local hour = 8, which reads the already-computed,
-- already-persisted rows (weekly_evaluation_results / league_cycles /
-- league_cycle_standings) rather than recomputing anything.
--
-- notified_at / notification_sent_at make that second pass idempotent and
-- self-healing: any run/cycle it hasn't notified yet gets caught on the next
-- local-8am tick, whichever group's clock that turns out to be.
-- ============================================================================

alter table weekly_evaluation_runs add column notified_at timestamptz;
alter table league_cycles add column notification_sent_at timestamptz;

-- Every run/cycle that already exists was already notified, the old way,
-- back when it happened — without this backfill, the first local-8am tick
-- of send_pending_weekly_notifications() below would find every one of them
-- "pending" and re-blast the whole history of weekly results and cycle
-- closures to every member, all at once.
update weekly_evaluation_runs set notified_at = ran_at where notified_at is null;
update league_cycles set notification_sent_at = completed_at where status = 'completed' and notification_sent_at is null;

-- ---- run_weekly_evaluation: same computation, gated at local midnight, no notifications ----
create or replace function run_weekly_evaluation()
returns setof weekly_evaluation_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_end date;
  v_week_start date;
  v_group record;
  v_local_hour int;
  v_local_dow int;
  v_member record;
  v_run_id uuid;
  v_completed int;
  v_excused int;
  v_activated_date date;
  v_days_present int;
  v_required int;
  v_effective_required int;
  v_failed int;
  v_penalty_start_date date;
  v_penalty_days_present int;
  v_penalty_required int;
  v_effective_penalty_required int;
  v_failed_for_penalty int;
  v_penalty_protected boolean;
  v_penalty numeric(12, 2);
  v_result_id uuid;
  v_run_ids uuid[] := '{}';
  v_due_proposal_id uuid;
  v_cycle_start_date date;
  v_excused_penalty int;
begin
  for v_group in select * from groups loop
    v_local_hour := extract(hour from (now() at time zone v_group.timezone))::int;
    v_local_dow := extract(isodow from (now() at time zone v_group.timezone))::int; -- 1 = Monday .. 7 = Sunday
    if v_local_hour <> 0 or v_local_dow <> 1 then
      continue;
    end if;

    v_week_end := (now() at time zone v_group.timezone)::date - 1;
    v_week_start := v_week_end - 6;

    begin
      insert into weekly_evaluation_runs (group_id, week_start_date, week_end_date)
        values (v_group.id, v_week_start, v_week_end)
        returning id into v_run_id;
    exception
      when unique_violation then
        continue;
    end;
    v_run_ids := v_run_ids || v_run_id;

    -- A league cycle that started MID-week snaps to that week's Monday; the days of
    -- the week before its real start day count as excused for everyone.
    v_cycle_start_date := null;
    select effective_start_date into v_cycle_start_date
      from league_cycles
      where group_id = v_group.id and status in ('running', 'completed')
        and (started_at at time zone v_group.timezone)::date = v_week_start
        and effective_start_date > v_week_start
      order by cycle_number desc
      limit 1;

    for v_member in
      select * from group_members
        where group_id = v_group.id and status in ('pending_deposit', 'active', 'needs_recharge')
    loop
      v_activated_date := (coalesce(v_member.activated_at, v_member.joined_at) at time zone v_group.timezone)::date;
      v_penalty_start_date := (
        coalesce(v_member.penalty_start_date, v_member.activated_at, v_member.joined_at) at time zone v_group.timezone
      )::date;

      select count(distinct d.the_date) into v_completed
        from (
          select checkin_date as the_date from checkins
            where group_id = v_group.id and user_id = v_member.user_id
              and checkin_date between v_week_start and v_week_end
              and checkin_date >= v_activated_date
          union
          select override_date as the_date from attendance_overrides
            where group_id = v_group.id and user_id = v_member.user_id and status = 'valid'
              and override_date between v_week_start and v_week_end
        ) d
        where not exists (
          select 1 from attendance_overrides fo
            where fo.group_id = v_group.id and fo.user_id = v_member.user_id and fo.status = 'failed'
              and fo.override_date = d.the_date
        );

      select count(*) into v_excused
        from excuse_dates
        where group_id = v_group.id and user_id = v_member.user_id
          and excused_date between v_week_start and v_week_end;

      v_excused_penalty := v_excused;
      if v_cycle_start_date is not null then
        v_excused := v_excused + greatest(0, v_cycle_start_date - greatest(v_week_start, v_activated_date));
        v_excused_penalty := v_excused_penalty + greatest(0, v_cycle_start_date - greatest(v_week_start, v_penalty_start_date));
      end if;

      v_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_activated_date)) + 1));
      v_required := least(v_group.min_days_per_week, v_days_present);
      v_effective_required := greatest(v_required - v_excused, 0);
      v_failed := greatest(v_effective_required - v_completed, 0);

      v_penalty_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_penalty_start_date)) + 1));
      v_penalty_required := least(v_group.min_days_per_week, v_penalty_days_present);
      v_effective_penalty_required := greatest(v_penalty_required - v_excused_penalty, 0);
      v_failed_for_penalty := greatest(v_effective_penalty_required - v_completed, 0);
      v_penalty_protected := v_penalty_start_date > v_week_start;

      v_penalty := case
        when v_group.payout_mode = 'league' then 0
        else least(v_failed_for_penalty * v_group.penalty_amount, v_group.weekly_penalty_cap)
      end;

      insert into weekly_evaluation_results (
        run_id, group_id, user_id, required_days, completed_days,
        excused_days_used, failed_days, penalty_charged, penalty_protected,
        balance_before, balance_after, status_after
      ) values (
        v_run_id, v_group.id, v_member.user_id, v_required, v_completed,
        v_excused, v_failed, v_penalty, v_penalty_protected, v_member.balance,
        v_member.balance - v_penalty,
        case when v_member.balance - v_penalty <= 0 then 'needs_recharge' else 'active' end
      ) returning id into v_result_id;

      -- Notifications for this result are sent later, at local 8am, by
      -- send_pending_weekly_notifications() — see below. Nothing pushed here.

      if v_penalty > 0 then
        insert into wallet_transactions (
          group_id, user_id, type, amount, status, weekly_evaluation_result_id, confirmed_at
        ) values (
          v_group.id, v_member.user_id, 'penalty', -v_penalty, 'confirmed', v_result_id, now()
        );
      end if;
    end loop;

    perform evaluate_due_league_cycle(v_group.id, v_week_end);

    select id into v_due_proposal_id
      from rule_proposals
      where group_id = v_group.id and status = 'approved' and applied_at is null and effective_at <= now()
      order by effective_at asc, decided_at asc limit 1;

    if v_due_proposal_id is not null then
      perform apply_rule_proposal(v_due_proposal_id);
    end if;
  end loop;

  return query select * from weekly_evaluation_runs where id = any(v_run_ids);
end;
$$;

-- ---- evaluate_due_league_cycle: same ranking/payout/freeze/auto-renew, no notifications ----
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

  -- Notifications (cycle closed / descenso / "start a new cycle" admin nudge)
  -- are sent later, at local 8am, by send_pending_weekly_notifications() —
  -- see below. Nothing pushed here.

  if v_group.league_auto_renew then
    -- The next cycle begins right away, on the Monday that follows the week just closed.
    perform start_league_cycle_at(p_group_id, ((p_as_of_week_end + 1)::timestamp) at time zone v_group.timezone);
  end if;
end;
$$;

-- ---- send_pending_weekly_notifications: the deferred, local-8am notification pass ----
-- Reads rows already computed/frozen by the local-midnight passes above and
-- sends whatever hasn't been notified yet. Idempotent (notified_at /
-- notification_sent_at gates), so a missed hour just catches up on the next
-- local-8am tick for that group.
create or replace function send_pending_weekly_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_local_hour int;
  v_run record;
  v_result record;
  v_message text;
  v_cycle record;
  v_descenso_user_ids uuid[];
begin
  for v_group in select * from groups loop
    v_local_hour := extract(hour from (now() at time zone v_group.timezone))::int;
    if v_local_hour <> 8 then
      continue;
    end if;

    for v_run in
      select * from weekly_evaluation_runs
        where group_id = v_group.id and notified_at is null
    loop
      for v_result in
        select * from weekly_evaluation_results where run_id = v_run.id
      loop
        if v_group.payout_mode = 'league' then
          v_message := format(
            'Semana registrada: %s de %s días entrenados. En modo Liga no hay multas — solo cuenta tu puesto en el ranking al final del ciclo.',
            v_result.completed_days, v_result.required_days
          );
        elsif v_result.failed_days = 0 then
          v_message := format('¡Cumpliste tu meta esta semana! Entrenaste %s de %s días requeridos.', v_result.completed_days, v_result.required_days);
        elsif v_result.penalty_charged = 0 and v_result.penalty_protected then
          v_message := format(
            'Esta semana entrenaste %s de %s días requeridos (%s fallado(s)), pero tu periodo de gracia sigue activo — sin penalización.',
            v_result.completed_days, v_result.required_days, v_result.failed_days
          );
        else
          v_message := format(
            'Esta semana entrenaste %s de %s días requeridos (%s fallado(s)). Penalización: %s %s.',
            v_result.completed_days, v_result.required_days, v_result.failed_days, v_group.currency, to_char(v_result.penalty_charged, 'FM999,999,999')
          );
        end if;
        perform send_push_notification(
          array[v_result.user_id], 'Resultado semanal', v_message,
          p_group_id => v_group.id, p_category => 'money'
        );

        if v_result.balance_after <= 0 then
          perform send_push_notification(
            array[v_result.user_id], 'Gym Buddies', 'Tu saldo llegó a $0 — recarga para seguir participando en el grupo.',
            p_group_id => v_group.id, p_category => 'money'
          );
        end if;
      end loop;

      update weekly_evaluation_runs set notified_at = now() where id = v_run.id;
    end loop;

    for v_cycle in
      select * from league_cycles
        where group_id = v_group.id and status = 'completed' and notification_sent_at is null
    loop
      perform send_push_notification(
        (select array_agg(user_id) from group_members where group_id = v_group.id and status in ('active', 'needs_recharge')),
        'Ciclo de Liga terminado', 'Se repartió el premio del ciclo de Liga — revisa Reglas para ver los resultados.',
        p_group_id => v_group.id, p_category => 'money'
      );

      select array_agg(user_id) into v_descenso_user_ids
        from league_cycle_standings where cycle_id = v_cycle.id and relegated;

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
          p_group_id => v_group.id, p_category => 'money'
        );
      end if;

      if not v_group.league_auto_renew and v_group.admin_id is not null then
        perform send_push_notification(
          array[v_group.admin_id], 'Inicia un nuevo ciclo de Liga',
          'El ciclo anterior terminó y el premio ya se repartió. Puedes iniciar el próximo ciclo desde Reglas.',
          p_group_id => v_group.id, p_category => 'admin_actions'
        );
      end if;

      update league_cycles set notification_sent_at = now() where id = v_cycle.id;
    end loop;
  end loop;
end;
$$;

select cron.schedule('weekly-notifications', '0 * * * *', $$select send_pending_weekly_notifications();$$);
