-- ============================================================================
-- Lets the creator of a new group choose, at creation time, whether they're
-- going to play too (deposit, check in, get penalized/ranked like everyone
-- else — the only option until now) or purely administer it (no deposit,
-- no attendance requirement, never shows up in the leaderboard or in any
-- money split).
--
-- Modeled as a brand-new group_members.status value, 'admin_only', rather
-- than a boolean flag threaded through every "active member" query in the
-- app — deliberately, so exclusion from money/attendance logic is automatic
-- everywhere instead of something that has to be remembered at every call
-- site. Every existing `status in ('active', 'needs_recharge')` or
-- `status in ('pending_deposit', 'active', 'needs_recharge')` filter across
-- both SQL (liquidate_group_now, run_weekly_evaluation, close_group,
-- fetchGroupAttendanceRecords' member query, ...) and the client already
-- naturally excludes any status string it doesn't explicitly list — an
-- 'admin_only' row silently fails every one of those checks with zero
-- changes needed there. That includes is_voting_member(), left deliberately
-- untouched below: an admin_only member can't submit_checkin/vote/propose/
-- excuse either, which is exactly "solo administra" (no gameplay actions).
--
-- The only two predicates that DO need to recognize 'admin_only' as a real,
-- ongoing membership are is_group_member()/is_group_admin() — the RLS/
-- action gates that decide "can this person see this group's data" and
-- "can this person act as its admin". Both already run through nearly
-- every policy and admin RPC in the app, so widening these two is enough
-- to give a non-participating admin full visibility and full admin powers
-- without touching any of the other ~50 call sites that reference the
-- status list.
-- ============================================================================

-- Widen the CHECK constraint dynamically (looked up by definition rather
-- than a guessed/hardcoded name) so this doesn't depend on how Postgres
-- happened to auto-name it back in 0002.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
    from pg_constraint
    where conrelid = 'group_members'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%pending_deposit%';
  if v_constraint_name is not null then
    execute format('alter table group_members drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table group_members add constraint group_members_status_check
  check (status in ('pending_deposit', 'active', 'needs_recharge', 'left', 'removed', 'admin_only'));

-- An admin_only row only ever makes sense for the group's admin — nothing
-- creates one any other way, but the constraint keeps that invariant real
-- rather than assumed.
alter table group_members add constraint group_members_admin_only_role_check
  check (status <> 'admin_only' or role = 'admin');

create or replace function is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id
      and user_id = auth.uid()
      and status in ('pending_deposit', 'active', 'needs_recharge', 'admin_only')
  );
$$;

create or replace function is_group_admin(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id
      and user_id = auth.uid()
      and role = 'admin'
      and status in ('pending_deposit', 'active', 'needs_recharge', 'admin_only')
  );
$$;

-- ----------------------------------------------------------------------------
-- create_group: same 20-param signature as today, plus one new trailing
-- p_admin_participates default true (existing callers keep working
-- unchanged). false skips 'pending_deposit' entirely — there's nothing for
-- a non-participating admin to deposit, so the client never even shows
-- them the deposit flow, and the member row is born directly as
-- 'admin_only' with its default balance of 0.
-- ----------------------------------------------------------------------------
drop function if exists create_group(
  text, numeric, integer, numeric, numeric, numeric, integer,
  boolean, integer, text, text, integer, jsonb, numeric, date, text, boolean, integer, numeric, numeric
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
    payout_mode, league_duration_months, league_prize_splits, mixed_league_share_percent,
    game_starts_at, timezone, is_public, descenso_rank_count, descenso_penalty_amount,
    enrollment_fee_amount
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info,
    p_payout_mode, p_league_duration_months, p_league_prize_splits, p_mixed_league_share_percent,
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
