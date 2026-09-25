-- ============================================================================
-- League cycle duration: MONTHS -> WEEKS.
--
-- Why: a cycle is graded on whole, already-closed Monday-Sunday weeks
-- (evaluate_due_league_cycle only counts weeks that start on/after the
-- cycle's started_at AND end on/before its ends_at, and only settles at a
-- Monday weekly evaluation) — so "3 months" was never really a number of
-- months, just a rough length that happened to land on some number of weeks.
-- The duration is now stored and edited directly in weeks.
--
-- What changes (and what deliberately does NOT):
--  - groups.league_duration_weeks / league_cycles.duration_weeks are the new
--    source of truth. Existing rows are backfilled: groups from months
--    (x 52/12, rounded), cycles from their real ends_at - started_at span.
--  - A RUNNING cycle's ends_at is NOT touched — a live cycle keeps the exact
--    end date it was started with. Only cycles started from now on
--    (start_league_cycle_at) use weeks: ends_at = started_at + N*7 days.
--  - The old *_months columns stay, but as GENERATED columns derived from
--    the weeks value, so a client still on the previous app version keeps
--    reading a sane number instead of a missing column.
--  - apply_rule_proposal / apply_rule_change_direct accept either key:
--    league_duration_weeks (new) or the legacy league_duration_months
--    (converted to weeks), so an old client's rule change still applies.
--  - create_group's param p_league_duration_months is renamed to
--    p_league_duration_weeks. Postgres can't rename a parameter via
--    create or replace, so the old 21-arg signature is dropped first (same
--    class of issue as 0104/0109). A client still on the previous app
--    version calling the old signature gets a clean "function not found"
--    until it updates — deliberately NOT kept as an overload, since two
--    overloads that only differ by a parameter name are exactly the
--    ambiguity trap that bit earlier RPCs.
-- ============================================================================

-- ---- groups ----------------------------------------------------------------
alter table groups add column league_duration_weeks int;

update groups
  set league_duration_weeks = greatest(1, round(league_duration_months * 52.0 / 12)::int);

alter table groups alter column league_duration_weeks set not null;
alter table groups alter column league_duration_weeks set default 13;
alter table groups add constraint groups_league_duration_weeks_check
  check (league_duration_weeks between 1 and 104);

alter table groups drop column league_duration_months;
alter table groups add column league_duration_months int
  generated always as (greatest(1, round(league_duration_weeks * 12.0 / 52)::int)) stored;

-- ---- league_cycles ----------------------------------------------------------
alter table league_cycles add column duration_weeks int;

update league_cycles
  set duration_weeks = greatest(1, round(extract(epoch from (ends_at - started_at)) / 604800.0)::int);

alter table league_cycles alter column duration_weeks set not null;
alter table league_cycles add constraint league_cycles_duration_weeks_check
  check (duration_weeks >= 1);

alter table league_cycles drop column duration_months;
alter table league_cycles add column duration_months int
  generated always as (greatest(1, round(duration_weeks * 12.0 / 52)::int)) stored;

-- ---- start_league_cycle_at: ends_at is now started_at + N whole weeks -------
-- Same signature/param names as 0091, so create or replace is enough.
create or replace function start_league_cycle_at(p_group_id uuid, p_started_at timestamptz)
returns league_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_next_number int;
  v_recipient_ids uuid[];
begin
  select * into v_group from groups where id = p_group_id;

  select coalesce(max(cycle_number), 0) + 1 into v_next_number from league_cycles where group_id = p_group_id;

  insert into league_cycles (
    group_id, cycle_number, prize_splits, duration_weeks, league_share_percent, started_at, ends_at
  ) values (
    p_group_id, v_next_number, v_group.league_prize_splits, v_group.league_duration_weeks,
    case when v_group.payout_mode = 'mixed' then v_group.mixed_league_share_percent else 100 end,
    p_started_at, p_started_at + make_interval(days => v_group.league_duration_weeks * 7)
  ) returning * into v_cycle;

  select array_agg(user_id) into v_recipient_ids
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Empezó un ciclo de Liga',
      format('Arrancó el ciclo #%s — dura %s semana(s).', v_next_number, v_group.league_duration_weeks),
      p_group_id => p_group_id, p_category => 'group_activity'
    );
  end if;

  return v_cycle;
end;
$$;

-- ---- set_running_league_cycle_start: recompute ends_at from the cycle's own weeks
-- Reproduces 0096's body; only the ends_at expression changes.
create or replace function set_running_league_cycle_start(p_group_id uuid, p_started_at date)
returns league_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_new_started_at timestamptz;
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;

  select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running' for update;
  if not found then
    return null;
  end if;

  v_new_started_at := (p_started_at::timestamp) at time zone v_group.timezone;

  update league_cycles
    set started_at = v_new_started_at,
        ends_at = v_new_started_at + make_interval(days => v_cycle.duration_weeks * 7)
    where id = v_cycle.id
    returning * into v_cycle;

  return v_cycle;
end;
$$;

-- ---- apply_rule_proposal: reproduces 0106's body, months line -> weeks -------
-- The CASE around the legacy key matters: greatest() ignores NULLs, so
-- without it a proposal that doesn't touch the duration would evaluate to
-- greatest(1, NULL) = 1 and silently reset the group to 1 week.
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
        league_duration_weeks = coalesce(
          (v_proposal.proposed_changes ->> 'league_duration_weeks')::int,
          case when v_proposal.proposed_changes ? 'league_duration_months'
            then greatest(1, round((v_proposal.proposed_changes ->> 'league_duration_months')::numeric * 52 / 12)::int)
          end,
          g.league_duration_weeks
        ),
        league_prize_splits = coalesce(v_proposal.proposed_changes -> 'league_prize_splits', g.league_prize_splits),
        mixed_league_share_percent = coalesce((v_proposal.proposed_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent),
        descenso_rank_count = coalesce((v_proposal.proposed_changes ->> 'descenso_rank_count')::int, g.descenso_rank_count),
        descenso_penalty_amount = coalesce((v_proposal.proposed_changes ->> 'descenso_penalty_amount')::numeric, g.descenso_penalty_amount)
        -- enrollment_fee_amount deliberately excluded — see 0106's header comment.
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

-- ---- apply_rule_change_direct: reproduces 0105's body, months line -> weeks ---
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
        league_duration_weeks = coalesce(
          (p_changes ->> 'league_duration_weeks')::int,
          case when p_changes ? 'league_duration_months'
            then greatest(1, round((p_changes ->> 'league_duration_months')::numeric * 52 / 12)::int)
          end,
          g.league_duration_weeks
        ),
        league_prize_splits = coalesce(p_changes -> 'league_prize_splits', g.league_prize_splits),
        mixed_league_share_percent = coalesce((p_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent),
        descenso_rank_count = coalesce((p_changes ->> 'descenso_rank_count')::int, g.descenso_rank_count),
        descenso_penalty_amount = coalesce((p_changes ->> 'descenso_penalty_amount')::numeric, g.descenso_penalty_amount),
        enrollment_fee_amount = coalesce((p_changes ->> 'enrollment_fee_amount')::numeric, g.enrollment_fee_amount)
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

-- ---- create_group: p_league_duration_months -> p_league_duration_weeks -------
-- Reproduces 0109's body; same 21 parameter TYPES in the same order, only
-- the 12th param's name/meaning and the insert column change. Drop first —
-- see the header comment for why create or replace can't do it.
drop function if exists create_group(
  text, numeric, integer, numeric, numeric, numeric, integer,
  boolean, integer, text, text, integer, jsonb, numeric, date, text, boolean, integer, numeric, numeric, boolean
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
  p_league_duration_weeks integer default 13,
  p_league_prize_splits jsonb default '[60, 30, 10]'::jsonb,
  p_mixed_league_share_percent numeric default 50,
  p_game_starts_at date default null::date,
  p_timezone text default 'America/Bogota'::text,
  p_is_public boolean default false,
  p_descenso_rank_count integer default 0,
  p_descenso_penalty_amount numeric default 0,
  p_enrollment_fee_amount numeric default 0,
  p_admin_participates boolean default true
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_game_starts_at timestamptz;
  v_is_platform_admin boolean;
  v_credits int;
begin
  select is_platform_admin, group_creation_credits into v_is_platform_admin, v_credits
    from profiles where id = auth.uid();

  if not coalesce(v_is_platform_admin, false) and coalesce(v_credits, 0) <= 0 then
    raise exception 'No tienes créditos disponibles para crear un grupo.';
  end if;

  if p_is_public and not coalesce(v_is_platform_admin, false) then
    raise exception 'only the platform admin can create a public group';
  end if;

  v_game_starts_at := case when p_game_starts_at is not null then (p_game_starts_at::timestamp) at time zone p_timezone else null end;

  insert into groups (
    name, invite_code, admin_id, initial_deposit_amount, min_days_per_week,
    penalty_amount, weekly_penalty_cap, exit_fee_amount, exit_notice_days,
    require_checkout_photo, min_workout_minutes, admin_payment_info,
    payout_mode, league_duration_weeks, league_prize_splits, mixed_league_share_percent,
    game_starts_at, timezone, is_public, descenso_rank_count, descenso_penalty_amount,
    enrollment_fee_amount
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info,
    p_payout_mode, p_league_duration_weeks, p_league_prize_splits, p_mixed_league_share_percent,
    v_game_starts_at, p_timezone, p_is_public, p_descenso_rank_count, p_descenso_penalty_amount,
    p_enrollment_fee_amount
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', case when p_admin_participates then 'pending_deposit' else 'admin_only' end);

  if p_payout_mode in ('league', 'mixed') then
    perform start_league_cycle_at(v_group.id, coalesce(v_game_starts_at, now()));
  end if;

  if not coalesce(v_is_platform_admin, false) then
    update profiles set group_creation_credits = group_creation_credits - 1 where id = auth.uid();
  end if;

  return v_group;
end;
$$;
