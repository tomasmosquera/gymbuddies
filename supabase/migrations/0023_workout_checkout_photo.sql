-- ============================================================================
-- New per-group settings, defaulting to today's behavior (off). When
-- require_checkout_photo is false, nothing about the check-in flow changes.
-- ============================================================================
alter table groups add column require_checkout_photo boolean not null default false;
alter table groups add column min_workout_minutes int not null default 0 check (min_workout_minutes >= 0);

-- ============================================================================
-- Checkout fields on checkins, all nullable — populated only once the
-- member submits their second photo. workout_minutes is computed once at
-- checkout time (not a generated column) so it survives even if
-- min_workout_minutes changes later. A missing/short checkout never blocks
-- attendance credit — run_weekly_evaluation still counts one checkins row
-- per date regardless of checkout status (product decision: informational
-- "Corto" label only, never a penalty trigger).
-- ============================================================================
alter table checkins add column checkout_captured_at timestamptz;
alter table checkins add column checkout_latitude double precision;
alter table checkins add column checkout_longitude double precision;
alter table checkins add column checkout_location_accuracy_m double precision;
alter table checkins add column checkout_photo_path text;
alter table checkins add column workout_minutes int;

-- ============================================================================
-- submit_workout_checkout: the only way to write the checkout_* columns —
-- mirrors set_checkin_date()'s clock-drift guard and same-day restriction
-- (checkins_update_self_today, 0012), but as an RPC instead of a wider
-- column grant, since this also validates ordering against the existing
-- captured_at and computes workout_minutes server-side.
-- ============================================================================
create or replace function submit_workout_checkout(
  p_checkin_id uuid,
  p_captured_at timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_location_accuracy_m double precision,
  p_photo_path text
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;
  if v_checkin.checkin_date <> (now() at time zone 'America/Bogota')::date then
    raise exception 'checkout can only be submitted the same day as the check-in';
  end if;
  if abs(extract(epoch from (now() - p_captured_at))) > 600 then
    raise exception 'captured_at is too far from server time (clock drift guard)';
  end if;
  if p_captured_at <= v_checkin.captured_at then
    raise exception 'checkout must be after the initial check-in';
  end if;

  update checkins
    set checkout_captured_at = p_captured_at,
        checkout_latitude = p_latitude,
        checkout_longitude = p_longitude,
        checkout_location_accuracy_m = p_location_accuracy_m,
        checkout_photo_path = p_photo_path,
        workout_minutes = greatest(round(extract(epoch from (p_captured_at - v_checkin.captured_at)) / 60)::int, 0)
    where id = p_checkin_id
    returning * into v_checkin;

  return v_checkin;
end;
$$;

-- ============================================================================
-- apply_rule_proposal (0019): extend the coalesce block with the 2 new
-- fields, same pattern as every other rule field. require_checkout_photo
-- and min_workout_minutes now flow through the same propose/vote/apply-
-- immediately-or-next-Monday machinery as every other group setting.
-- ============================================================================
create or replace function apply_rule_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal rule_proposals%rowtype;
begin
  select * into v_proposal from rule_proposals where id = p_proposal_id for update;
  if not found or v_proposal.applied_at is not null then
    return;
  end if;

  update groups g
    set min_days_per_week = coalesce((v_proposal.proposed_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
        penalty_amount = coalesce((v_proposal.proposed_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
        weekly_penalty_cap = coalesce((v_proposal.proposed_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
        exit_fee_amount = coalesce((v_proposal.proposed_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
        exit_notice_days = coalesce((v_proposal.proposed_changes ->> 'exit_notice_days')::int, g.exit_notice_days),
        require_checkout_photo = coalesce((v_proposal.proposed_changes ->> 'require_checkout_photo')::boolean, g.require_checkout_photo),
        min_workout_minutes = coalesce((v_proposal.proposed_changes ->> 'min_workout_minutes')::int, g.min_workout_minutes)
    where g.id = v_proposal.group_id;

  update rule_proposals set status = 'applied', applied_at = now() where id = p_proposal_id;
end;
$$;

-- ============================================================================
-- create_group: new groups can also set this at creation time. Both default
-- to off/0 so omitting them preserves today's create_group behavior.
-- Signature changes -> drop the old 8-arg overload first (established
-- pattern, see 0015/0019).
-- ============================================================================
drop function if exists create_group(text, numeric, int, numeric, numeric, numeric, int, text);

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
  p_admin_payment_info text default null
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
begin
  insert into groups (
    name, invite_code, admin_id, initial_deposit_amount, min_days_per_week,
    penalty_amount, weekly_penalty_cap, exit_fee_amount, exit_notice_days,
    require_checkout_photo, min_workout_minutes, admin_payment_info
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', 'pending_deposit');
  return v_group;
end;
$$;
