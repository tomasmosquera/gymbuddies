-- ============================================================================
-- Group creation credits — first piece of the "admins pay to create groups"
-- monetization model (in-app purchase of credits is a separate, much larger
-- piece, deliberately out of scope here — this only covers tracking,
-- free grants, and consumption).
--
-- profiles rows are created by handle_new_user() (0001), a trigger on
-- auth.users insert that only lists id/full_name/phone — every other column
-- is left to its default. Adding group_creation_credits with a default
-- requires zero changes to that trigger: new signups get it automatically,
-- and because Postgres applies a column's default to existing rows too when
-- it's added, every current user gets their free credit in this same
-- migration — no separate backfill update needed.
--
-- The platform admin (profiles.is_platform_admin, already used to gate
-- is_public group creation) is exempt from spending credits — same elevated
-- standing they already have.
-- ============================================================================

alter table profiles add column group_creation_credits integer not null default 1
  check (group_creation_credits >= 0);

-- ----------------------------------------------------------------------------
-- create_group: same public signature as today (the credit check reads from
-- the caller's own profile via auth.uid(), not a new parameter — no overload
-- concerns this time).
-- ----------------------------------------------------------------------------
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
  p_enrollment_fee_amount numeric default 0
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
    values (v_group.id, auth.uid(), 'admin', 'pending_deposit');

  if p_payout_mode in ('league', 'mixed') then
    perform start_league_cycle_at(v_group.id, coalesce(v_game_starts_at, now()));
  end if;

  if not coalesce(v_is_platform_admin, false) then
    update profiles set group_creation_credits = group_creation_credits - 1 where id = auth.uid();
  end if;

  return v_group;
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_find_user_by_email: platform-admin-only lookup of any user by email
-- — nothing like this exists today (every other admin lookup is scoped to
-- one group's own members, blocked by RLS for anyone outside it). Joins
-- auth.users the same way handle_new_user() already does internally.
-- ----------------------------------------------------------------------------
create or replace function admin_find_user_by_email(p_email text)
returns table(id uuid, full_name text, group_creation_credits int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce((select is_platform_admin from profiles where id = auth.uid()), false) then
    raise exception 'only the platform admin can look up users';
  end if;

  return query
    select p.id, p.full_name, p.group_creation_credits
      from profiles p
      join auth.users u on u.id = p.id
      where lower(u.email) = lower(p_email);
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_grant_group_creation_credits: platform-admin-only. p_amount can be
-- negative (to take credits back) — the resulting balance is floored at 0,
-- never allowed to go negative regardless of direction.
-- ----------------------------------------------------------------------------
create or replace function admin_grant_group_creation_credits(p_user_id uuid, p_amount int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance int;
begin
  if not coalesce((select is_platform_admin from profiles where id = auth.uid()), false) then
    raise exception 'only the platform admin can grant credits';
  end if;

  update profiles
    set group_creation_credits = greatest(group_creation_credits + p_amount, 0)
    where id = p_user_id
    returning group_creation_credits into v_new_balance;

  if not found then
    raise exception 'user not found';
  end if;

  return v_new_balance;
end;
$$;
