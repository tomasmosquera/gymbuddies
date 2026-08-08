-- ============================================================================
-- Public groups: discoverable/searchable/filterable from "Mis grupos" without
-- needing an invite code — everything else about a public group (checkins,
-- balances, members, rules) stays exactly as private as a regular group's
-- always been; only how it's *found* changes. Only the platform admin
-- (profiles.is_platform_admin, not a hardcoded email in SQL so it can be
-- granted to someone else later without a migration) can create one or flip
-- an existing group to public. Any group admin can flip their own group back
-- to private without that flag — only turning it ON is the privileged action.
-- ============================================================================

alter table profiles add column is_platform_admin boolean not null default false;
alter table groups add column is_public boolean not null default false;
create index groups_is_public_idx on groups (is_public) where is_public = true;

-- One-time grant, same auth.users read pattern delete_own_account already
-- uses (`delete from auth.users where id = v_user_id`) — security definer
-- functions/migrations can read auth.users directly.
update profiles set is_platform_admin = true
  where id = (select id from auth.users where email = 'tomasmosquera@hotmail.com');

-- ============================================================================
-- create_group: adds p_is_public, gated on is_platform_admin. Full body
-- reproduced from 0070_group_timezone_support.sql (the version in effect),
-- only the new param/check/column are added.
-- ============================================================================
create or replace function create_group(
  p_name text,
  p_initial_deposit_amount numeric,
  p_min_days_per_week int,
  p_penalty_amount numeric,
  p_weekly_penalty_cap numeric,
  p_exit_fee_amount numeric,
  p_exit_notice_days int,
  p_require_checkout_photo boolean default false,
  p_min_workout_minutes int default 0,
  p_admin_payment_info text default null,
  p_payout_mode text default 'cooperative',
  p_league_duration_months int default 3,
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
begin
  if p_is_public and not coalesce((select is_platform_admin from profiles where id = auth.uid()), false) then
    raise exception 'only the platform admin can create a public group';
  end if;

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
    case when p_game_starts_at is not null then (p_game_starts_at::timestamp) at time zone p_timezone else null end,
    p_timezone, p_is_public
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', 'pending_deposit');
  return v_group;
end;
$$;

-- ============================================================================
-- join_group_membership: the "create or reactivate this membership" logic
-- that used to live entirely inside join_group — extracted so join_group
-- (by invite code) and join_public_group (by id, public groups only) share
-- one implementation. Takes the group row already resolved by the caller.
-- ============================================================================
create or replace function join_group_membership(p_group groups)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
  v_member_existed boolean;
  v_full_name text;
begin
  select full_name into v_full_name from profiles where id = auth.uid();

  select * into v_member from group_members
    where group_id = p_group.id and user_id = auth.uid();
  v_member_existed := found;

  if v_member_existed then
    if v_member.status in ('active', 'needs_recharge', 'pending_deposit') then
      raise exception 'already a member of this group';
    end if;
    if v_member.status = 'removed' then
      raise exception 'you were removed from this group and cannot rejoin';
    end if;
    update group_members
      set status = 'pending_deposit', joined_at = now(), activated_at = null, penalty_start_date = null
      where id = v_member.id
      returning * into v_member;
  else
    insert into group_members (group_id, user_id, role, status)
      values (p_group.id, auth.uid(), 'member', 'pending_deposit')
      returning * into v_member;
  end if;

  if p_group.admin_id is not null and p_group.admin_id <> auth.uid() then
    perform send_push_notification(
      array[p_group.admin_id], 'Gym Buddies',
      format('%s se unió al grupo "%s" — falta confirmar su depósito.', v_full_name, p_group.name),
      p_group_id => p_group.id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'new_member')
    );
  end if;

  return v_member;
end;
$$;

-- Internal helper only — join_group/join_public_group call it as their own
-- SECURITY DEFINER owner (unaffected by this revoke), but it must never be
-- callable directly over PostgREST: it takes a full `groups` row and
-- unconditionally creates/reactivates a membership with no invite-code or
-- is_public check of its own — same precedent as pay_out_departing_member.
revoke execute on function join_group_membership(groups) from authenticated;

-- join_group: unchanged behavior, now delegates to join_group_membership.
create or replace function join_group(p_invite_code text)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
begin
  select * into v_group from groups where invite_code = upper(p_invite_code);
  if not found then
    raise exception 'invalid invite code';
  end if;
  return join_group_membership(v_group);
end;
$$;

-- ============================================================================
-- join_public_group: browse-and-join path, no code needed — only for groups
-- with is_public = true. Same generic error whether the id doesn't exist or
-- just isn't public, so this can't be used to probe for private group ids.
-- ============================================================================
create or replace function join_public_group(p_group_id uuid)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
begin
  select * into v_group from groups where id = p_group_id and is_public = true;
  if not found then
    raise exception 'group not found or not public';
  end if;
  return join_group_membership(v_group);
end;
$$;

-- ============================================================================
-- list_public_groups: the only read path into public groups' data for
-- non-members — deliberately a curated column list via a SECURITY DEFINER
-- function rather than widening groups_select RLS, so invite_code and
-- admin_payment_info never leak through a client-side `select *`. Every
-- filter param defaults to null (no filtering).
-- ============================================================================
create or replace function list_public_groups(
  p_search text default null,
  p_payout_mode text default null,
  p_max_initial_deposit numeric default null,
  p_max_penalty_amount numeric default null,
  p_max_min_days_per_week int default null,
  p_timezone text default null
)
returns table (
  id uuid,
  name text,
  currency text,
  payout_mode text,
  min_days_per_week int,
  penalty_amount numeric,
  initial_deposit_amount numeric,
  timezone text,
  member_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.currency, g.payout_mode, g.min_days_per_week, g.penalty_amount,
    g.initial_deposit_amount, g.timezone,
    (select count(*) from group_members gm where gm.group_id = g.id and gm.status in ('active', 'needs_recharge')) as member_count
  from groups g
  where g.is_public
    and (p_search is null or g.name ilike '%' || p_search || '%')
    and (p_payout_mode is null or g.payout_mode = p_payout_mode)
    and (p_max_initial_deposit is null or g.initial_deposit_amount <= p_max_initial_deposit)
    and (p_max_penalty_amount is null or g.penalty_amount <= p_max_penalty_amount)
    and (p_max_min_days_per_week is null or g.min_days_per_week <= p_max_min_days_per_week)
    and (p_timezone is null or g.timezone = p_timezone)
  order by g.created_at desc;
$$;

-- ============================================================================
-- admin_set_group_public: lets a group's own admin flip is_public. Turning
-- it ON requires the platform-admin flag; turning it OFF (opting out of
-- public visibility) only requires being that group's admin.
-- ============================================================================
create or replace function admin_set_group_public(p_group_id uuid, p_is_public boolean)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can change this';
  end if;
  if p_is_public and not coalesce((select is_platform_admin from profiles where id = auth.uid()), false) then
    raise exception 'only the platform admin can make a group public';
  end if;

  update groups set is_public = p_is_public where id = p_group_id returning * into v_group;
  return v_group;
end;
$$;
