-- ============================================================================
-- Lets a group be created with no money owed at join time at all — initial
-- deposit AND enrollment fee both $0 (a pure "just track attendance, split
-- penalties among ourselves" cooperative group with nothing to pay upfront).
-- Previously initial_deposit_amount required > 0 unconditionally, so even a
-- group with no real deposit still put every new member through
-- 'pending_deposit' ("Sin depósito"/"Falta depósito" badges, the deposit.tsx
-- screen, the admin "confirmar depósito" panel) for an amount that was never
-- actually owed. enrollment_fee_amount was already >= 0 and optional — this
-- migration only relaxes initial_deposit_amount to match, and makes both
-- places that assign a brand-new membership's status skip 'pending_deposit'
-- (going straight to 'active') when there's genuinely nothing to collect.
-- ============================================================================

alter table groups drop constraint groups_initial_deposit_amount_check;
alter table groups add constraint groups_initial_deposit_amount_check check (initial_deposit_amount >= 0);

-- create_group: the admin's own first-member row, when p_admin_participates —
-- unchanged otherwise (admin_only stays admin_only regardless of deposit).
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
  p_admin_participates boolean default true,
  p_league_auto_renew boolean default false
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
  v_nothing_owed boolean;
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
  v_nothing_owed := p_initial_deposit_amount = 0 and p_enrollment_fee_amount = 0;

  insert into groups (
    name, invite_code, admin_id, initial_deposit_amount, min_days_per_week,
    penalty_amount, weekly_penalty_cap, exit_fee_amount, exit_notice_days,
    require_checkout_photo, min_workout_minutes, admin_payment_info,
    payout_mode, league_duration_weeks, league_prize_splits, mixed_league_share_percent,
    game_starts_at, timezone, is_public, descenso_rank_count, descenso_penalty_amount,
    enrollment_fee_amount, league_auto_renew
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info,
    p_payout_mode, p_league_duration_weeks, p_league_prize_splits, p_mixed_league_share_percent,
    v_game_starts_at, p_timezone, p_is_public, p_descenso_rank_count, p_descenso_penalty_amount,
    p_enrollment_fee_amount, p_league_auto_renew
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (
      v_group.id, auth.uid(), 'admin',
      case
        when not p_admin_participates then 'admin_only'
        when v_nothing_owed then 'active'
        else 'pending_deposit'
      end
    );

  if p_payout_mode in ('league', 'mixed') then
    perform start_league_cycle_at(v_group.id, coalesce(v_game_starts_at, now()));
  end if;

  if not coalesce(v_is_platform_admin, false) then
    update profiles set group_creation_credits = group_creation_credits - 1 where id = auth.uid();
  end if;

  return v_group;
end;
$$;

-- join_group_membership: same "nothing owed -> active" logic for everyone
-- joining an existing group afterwards (by invite code or public listing).
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
  v_nothing_owed boolean;
  v_status text;
begin
  select full_name into v_full_name from profiles where id = auth.uid();

  v_nothing_owed := p_group.initial_deposit_amount = 0 and p_group.enrollment_fee_amount = 0;
  v_status := case when v_nothing_owed then 'active' else 'pending_deposit' end;

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
      set status = v_status, joined_at = now(), activated_at = case when v_nothing_owed then now() else null end, penalty_start_date = null
      where id = v_member.id
      returning * into v_member;
  else
    insert into group_members (group_id, user_id, role, status, activated_at)
      values (p_group.id, auth.uid(), 'member', v_status, case when v_nothing_owed then now() else null end)
      returning * into v_member;
  end if;

  if p_group.admin_id is not null and p_group.admin_id <> auth.uid() then
    perform send_push_notification(
      array[p_group.admin_id], 'Gym Buddies',
      case
        when v_nothing_owed then format('%s se unió al grupo "%s".', v_full_name, p_group.name)
        else format('%s se unió al grupo "%s" — falta confirmar su depósito.', v_full_name, p_group.name)
      end,
      p_group_id => p_group.id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'new_member')
    );
  end if;

  return v_member;
end;
$$;
