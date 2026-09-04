-- ============================================================================
-- DESCENSO (relegation) for League mode: an optional rule that penalizes the
-- bottom N players of a league cycle's ranking with a fixed amount (which can
-- be $0 — just marks them without charging). Only applies to
-- payout_mode = 'league' (never 'mixed', which already charges a real
-- per-missed-day penalty; never 'cooperative'). The money collected is added
-- to THIS SAME CYCLE's prize pool before it gets split among the winners —
-- it doesn't carry over to the next cycle.
--
-- evaluate_due_league_cycle is the only ranking implementation that actually
-- runs unattended (via run_weekly_evaluation's hourly cron) and pays real
-- money automatically, so it's the only place this needs to charge anything.
-- liquidate_group_now (the manual "cash everyone out now" tool, also what
-- feeds the live Home preview) is intentionally left untouched here.
--
-- Same tie philosophy the prize-split loop already uses: a tie straddling
-- the "last N" boundary is relegated WHOLESALE (never arbitrarily split), so
-- the real number of relegated members can exceed descenso_rank_count when
-- there's a tie right at the cutoff.
--
-- Zero-sum: every wallet_transactions insert in one run of this function
-- must still net to zero across the group (pure redistribution), same
-- invariant the function already guaranteed before this change. Verified
-- with a worked example (5 members, pool $500, splits [60,30,10],
-- descenso_rank_count=1, descenso_penalty_amount=$20): last place pays -$20,
-- pool becomes $520, winners split $520, and the "aporte al premio" step
-- (which spreads the cost of the prize across everyone) is computed on
-- ($520 distributed - $20 descenso) = $500, so the extra $20 in prizes is
-- funded exactly by the relegated member, not diluted across the group.
--
-- Accepted edge cases (no extra guard, documented here instead):
--  - descenso_rank_count large enough to reach 1st place: that member can be
--    both a prize winner AND relegated in the same run — admin
--    misconfiguration, not blocked.
--  - descenso collected > actual prize distributed (e.g. a small/empty
--    league_prize_splits): the excess is simply not funded back to anyone —
--    same as any other charge in this mode with nothing to redistribute it
--    into. The funding step is skipped entirely (not even $0 rows) once
--    descenso alone already covers the full prize.
-- ============================================================================

alter table groups add column descenso_rank_count int not null default 0
  check (descenso_rank_count >= 0 and descenso_rank_count <= 20);
alter table groups add column descenso_penalty_amount numeric(12, 2) not null default 0
  check (descenso_penalty_amount >= 0);

-- ----------------------------------------------------------------------------
-- evaluate_due_league_cycle: reproduces the live body, with the prize loop
-- restructured into a single ranking scan (no more `exit when place >
-- prize_len` short-circuit while descenso is active — every rank group has
-- to be visited to find the bottom N). Prize winners are buffered into
-- arrays instead of paid immediately, because their amount depends on the
-- pool AFTER descenso is added to it, which isn't known until the scan ends.
-- ----------------------------------------------------------------------------
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
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.payout_mode = 'cooperative' then
    return;
  end if;

  select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running' for update;
  if not found or v_cycle.ends_at::date > p_as_of_week_end then
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
          and wr.week_start_date >= v_cycle.started_at::date
          and wr.week_end_date <= v_cycle.ends_at::date
        group by wer.user_id
    ),
    per_user_minutes as (
      select c.user_id, sum(c.workout_minutes) as minutes
        from checkins c
        where c.group_id = p_group_id
          and c.checkin_date >= v_cycle.started_at::date
          and c.checkin_date <= v_cycle.ends_at::date
        group by c.user_id
    ),
    eligible as (
      select gm.user_id from group_members gm
        where gm.group_id = p_group_id and gm.status in ('active', 'needs_recharge')
    ),
    ranked as (
      select
        e.user_id,
        rank() over (
          order by
            coalesce(pu.completed - pu.failed, -999999) desc,
            case when v_group.require_checkout_photo then coalesce(pum.minutes, 0) else 0 end desc
        ) as place
        from eligible e
        left join per_user pu on pu.user_id = e.user_id
        left join per_user_minutes pum on pum.user_id = e.user_id
    )
    select place, array_agg(user_id order by user_id) as users, count(*)::int as k
      from ranked
      group by place
      order by place
  loop
    -- Without descenso this is the same short-circuit as before (nothing
    -- past the prize list matters). With descenso active, every rank group
    -- has to be visited to reach the bottom N at the tail of the ranking.
    exit when v_rank_group.place > v_prize_len and not v_descenso_active;

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

  if v_group.admin_id is not null then
    perform send_push_notification(
      array[v_group.admin_id], 'Inicia un nuevo ciclo de Liga',
      'El ciclo anterior terminó y el premio ya se repartió. Puedes iniciar el próximo ciclo desde Reglas.',
      p_group_id => p_group_id, p_category => 'admin_actions'
    );
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_group: 2 new trailing params. Postgres identifies a function by its
-- argument TYPE list, not by which ones have defaults — adding 2 more
-- params makes this a different signature than the live 17-arg one, so
-- `create or replace` alone would leave both overloaded and ambiguous.
-- Explicitly drop the old 17-arg signature first (matches the pattern
-- already established for this exact class of bug).
-- ----------------------------------------------------------------------------
drop function if exists create_group(
  text, numeric, integer, numeric, numeric, numeric, integer,
  boolean, integer, text, text, integer, jsonb, numeric, date, text, boolean
);

create or replace function create_group(
  p_name text,
  p_initial_deposit_amount numeric,
  p_min_days_per_week integer,
  p_penalty_amount numeric,
  p_weekly_penalty_cap numeric,
  p_exit_fee_amount numeric,
  p_exit_notice_days integer,
  p_require_checkout_photo boolean default false,
  p_min_workout_minutes integer default 0,
  p_admin_payment_info text default null::text,
  p_payout_mode text default 'cooperative'::text,
  p_league_duration_months integer default 3,
  p_league_prize_splits jsonb default '[60, 30, 10]'::jsonb,
  p_mixed_league_share_percent numeric default 50,
  p_game_starts_at date default null::date,
  p_timezone text default 'America/Bogota'::text,
  p_is_public boolean default false,
  p_descenso_rank_count int default 0,
  p_descenso_penalty_amount numeric default 0
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_game_starts_at timestamptz;
begin
  if p_is_public and not coalesce((select is_platform_admin from profiles where id = auth.uid()), false) then
    raise exception 'only the platform admin can create a public group';
  end if;

  v_game_starts_at := case when p_game_starts_at is not null then (p_game_starts_at::timestamp) at time zone p_timezone else null end;

  insert into groups (
    name, invite_code, admin_id, initial_deposit_amount, min_days_per_week,
    penalty_amount, weekly_penalty_cap, exit_fee_amount, exit_notice_days,
    require_checkout_photo, min_workout_minutes, admin_payment_info,
    payout_mode, league_duration_months, league_prize_splits, mixed_league_share_percent,
    game_starts_at, timezone, is_public, descenso_rank_count, descenso_penalty_amount
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info,
    p_payout_mode, p_league_duration_months, p_league_prize_splits, p_mixed_league_share_percent,
    v_game_starts_at, p_timezone, p_is_public, p_descenso_rank_count, p_descenso_penalty_amount
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', 'pending_deposit');

  if p_payout_mode in ('league', 'mixed') then
    perform start_league_cycle_at(v_group.id, coalesce(v_game_starts_at, now()));
  end if;

  return v_group;
end;
$$;

-- ----------------------------------------------------------------------------
-- apply_rule_proposal / apply_rule_change_direct: 2 new coalesce lines each,
-- same idiom as every other rule field.
-- ----------------------------------------------------------------------------
create or replace function apply_rule_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal rule_proposals%rowtype;
  v_old_mode text;
begin
  select * into v_proposal from rule_proposals where id = p_proposal_id for update;
  if not found or v_proposal.applied_at is not null then
    return;
  end if;

  select payout_mode into v_old_mode from groups where id = v_proposal.group_id;

  update groups g
    set min_days_per_week = coalesce((v_proposal.proposed_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
        penalty_amount = coalesce((v_proposal.proposed_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
        weekly_penalty_cap = coalesce((v_proposal.proposed_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
        exit_fee_amount = coalesce((v_proposal.proposed_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
        exit_notice_days = coalesce((v_proposal.proposed_changes ->> 'exit_notice_days')::int, g.exit_notice_days),
        require_checkout_photo = coalesce((v_proposal.proposed_changes ->> 'require_checkout_photo')::boolean, g.require_checkout_photo),
        min_workout_minutes = coalesce((v_proposal.proposed_changes ->> 'min_workout_minutes')::int, g.min_workout_minutes),
        payout_mode = coalesce(v_proposal.proposed_changes ->> 'payout_mode', g.payout_mode),
        league_duration_months = coalesce((v_proposal.proposed_changes ->> 'league_duration_months')::int, g.league_duration_months),
        league_prize_splits = coalesce(v_proposal.proposed_changes -> 'league_prize_splits', g.league_prize_splits),
        mixed_league_share_percent = coalesce((v_proposal.proposed_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent),
        descenso_rank_count = coalesce((v_proposal.proposed_changes ->> 'descenso_rank_count')::int, g.descenso_rank_count),
        descenso_penalty_amount = coalesce((v_proposal.proposed_changes ->> 'descenso_penalty_amount')::numeric, g.descenso_penalty_amount)
    where g.id = v_proposal.group_id;

  if v_old_mode in ('league', 'mixed') and (v_proposal.proposed_changes ->> 'payout_mode') = 'cooperative' then
    update league_cycles set status = 'cancelled', completed_at = now()
      where group_id = v_proposal.group_id and status = 'running';
  end if;

  if v_proposal.proposed_changes ? 'league_cycle_started_at' then
    perform set_running_league_cycle_start(
      v_proposal.group_id, (v_proposal.proposed_changes ->> 'league_cycle_started_at')::date
    );
  end if;

  update rule_proposals set status = 'applied', applied_at = now() where id = p_proposal_id;
end;
$$;

create or replace function apply_rule_change_direct(p_group_id uuid, p_changes jsonb)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_recipient_ids uuid[];
  v_old_mode text;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can apply rule changes directly';
  end if;

  select payout_mode into v_old_mode from groups where id = p_group_id;

  update groups g
    set min_days_per_week = coalesce((p_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
        penalty_amount = coalesce((p_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
        weekly_penalty_cap = coalesce((p_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
        exit_fee_amount = coalesce((p_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
        exit_notice_days = coalesce((p_changes ->> 'exit_notice_days')::int, g.exit_notice_days),
        require_checkout_photo = coalesce((p_changes ->> 'require_checkout_photo')::boolean, g.require_checkout_photo),
        min_workout_minutes = coalesce((p_changes ->> 'min_workout_minutes')::int, g.min_workout_minutes),
        payout_mode = coalesce(p_changes ->> 'payout_mode', g.payout_mode),
        league_duration_months = coalesce((p_changes ->> 'league_duration_months')::int, g.league_duration_months),
        league_prize_splits = coalesce(p_changes -> 'league_prize_splits', g.league_prize_splits),
        mixed_league_share_percent = coalesce((p_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent),
        descenso_rank_count = coalesce((p_changes ->> 'descenso_rank_count')::int, g.descenso_rank_count),
        descenso_penalty_amount = coalesce((p_changes ->> 'descenso_penalty_amount')::numeric, g.descenso_penalty_amount)
    where g.id = p_group_id
    returning * into v_group;

  if not found then
    raise exception 'group not found';
  end if;

  if v_old_mode in ('league', 'mixed') and (p_changes ->> 'payout_mode') = 'cooperative' then
    update league_cycles set status = 'cancelled', completed_at = now()
      where group_id = p_group_id and status = 'running';
  end if;

  if p_changes ? 'league_cycle_started_at' then
    perform set_running_league_cycle_start(p_group_id, (p_changes ->> 'league_cycle_started_at')::date);
  end if;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Reglas actualizadas',
      'El administrador actualizó las reglas del grupo directamente, sin necesidad de votación.',
      p_group_id => p_group_id, p_category => 'votes'
    );
  end if;

  return v_group;
end;
$$;
