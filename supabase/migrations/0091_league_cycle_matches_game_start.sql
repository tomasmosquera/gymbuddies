-- ============================================================================
-- Bug: creating a group in league/mixed mode with a game_starts_at date never
-- actually started a league cycle — start_league_cycle() is a separate,
-- manual admin action (the "Iniciar ciclo de Liga" button in Reglas), and it
-- always stamped started_at = now() the moment it was clicked, completely
-- ignoring the group's own game_starts_at. So even a group whose admin
-- diligently set "empezamos el lunes 10 de agosto" at creation time got no
-- cycle at all until someone remembered to click the button — and even then,
-- the cycle's start date would be whatever day THAT click happened to land
-- on, not the intended game_starts_at.
--
-- Fix: create_group() now auto-starts the group's first league cycle
-- (payout_mode in ('league','mixed')) immediately, using game_starts_at (or
-- now() if that was left blank) as started_at — game start date and first
-- cycle start date are the same value by construction, no separate manual
-- step, no room for the two to drift apart. The cycle-insertion logic itself
-- is pulled into a shared start_league_cycle_at() so create_group() and the
-- existing manual "start the next cycle after this one ends" button both go
-- through the same code path — the button (start_league_cycle) still exists
-- for cycle #2 onward, still using now() (a renewal has no "game start"
-- concept to align with).
-- ============================================================================

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
    group_id, cycle_number, prize_splits, duration_months, league_share_percent, started_at, ends_at
  ) values (
    p_group_id, v_next_number, v_group.league_prize_splits, v_group.league_duration_months,
    case when v_group.payout_mode = 'mixed' then v_group.mixed_league_share_percent else 100 end,
    p_started_at, p_started_at + (v_group.league_duration_months || ' months')::interval
  ) returning * into v_cycle;

  select array_agg(user_id) into v_recipient_ids
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Empezó un ciclo de Liga',
      format('Arrancó el ciclo #%s — dura %s mes(es).', v_next_number, v_group.league_duration_months),
      p_group_id => p_group_id, p_category => 'group_activity'
    );
  end if;

  return v_cycle;
end;
$$;

create or replace function start_league_cycle(p_group_id uuid)
returns league_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can start a league cycle';
  end if;
  if v_group.payout_mode = 'cooperative' then
    raise exception 'this group is not in league or mixed mode';
  end if;
  if exists (select 1 from league_cycles where group_id = p_group_id and status = 'running') then
    raise exception 'a league cycle is already running for this group';
  end if;

  return start_league_cycle_at(p_group_id, now());
end;
$$;

-- Drop the 3 stale create_group() overloads left behind by earlier
-- create-or-replace edits that changed its argument list (payout_mode/
-- league fields, then timezone, then is_public) — create or replace never
-- removes a signature when the params themselves change, only when they
-- match exactly. The client always calls with the full current param set,
-- so these were already dead, but leaving stale overloads around is exactly
-- the class of bug that bit submit_koth_claim (0076) and
-- create_excuse_request (0078) — cheap to clean up while touching this
-- function anyway.
drop function if exists create_group(
  text, numeric, integer, numeric, numeric, numeric, integer, boolean, integer, text
);
drop function if exists create_group(
  text, numeric, integer, numeric, numeric, numeric, integer, boolean, integer, text, text, integer, jsonb, numeric, date
);
drop function if exists create_group(
  text, numeric, integer, numeric, numeric, numeric, integer, boolean, integer, text, text, integer, jsonb, numeric, date, text
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
  p_admin_payment_info text default null,
  p_payout_mode text default 'cooperative',
  p_league_duration_months integer default 3,
  p_league_prize_splits jsonb default '[60, 30, 10]'::jsonb,
  p_mixed_league_share_percent numeric default 50,
  p_game_starts_at date default null,
  p_timezone text default 'America/Bogota',
  p_is_public boolean default false
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
    game_starts_at, timezone, is_public
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info,
    p_payout_mode, p_league_duration_months, p_league_prize_splits, p_mixed_league_share_percent,
    v_game_starts_at, p_timezone, p_is_public
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', 'pending_deposit');

  if p_payout_mode in ('league', 'mixed') then
    perform start_league_cycle_at(v_group.id, coalesce(v_game_starts_at, now()));
  end if;

  return v_group;
end;
$$;
