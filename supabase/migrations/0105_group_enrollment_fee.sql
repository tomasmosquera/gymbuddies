-- ============================================================================
-- Enrollment fee (cuota de inscripción): an optional, admin-configured fixed
-- amount charged to every new member on top of the group's own
-- initial_deposit_amount when they join. Unlike the deposit, this money goes
-- straight to the admin and must NEVER count toward group_members.balance
-- (the pooled amount that funds payouts in every mode — league prize pool,
-- cooperative split-on-exit, etc.).
--
-- Applies to ALL payout modes (unlike descenso, which is league-only) — every
-- mode uses group_members.balance for its own payout math, so the exclusion
-- matters everywhere equally.
--
-- Design: a single wallet_transactions row per deposit, with the enrollment
-- fee living in its OWN column (enrollment_fee_amount) instead of being
-- folded into `amount`. apply_wallet_transaction_effect only ever adds
-- `amount` to the member's balance — verified live before writing this
-- migration — so keeping the fee in a separate column excludes it from the
-- pool BY CONSTRUCTION, with zero changes needed to that trigger. This also
-- keeps the existing "one receipt = one row" invariant used everywhere else
-- in this schema (no linked-transaction plumbing, no new confirm RPC — the
-- admin still confirms/rejects with the exact same single-row update
-- admin-transactions.tsx already does).
--
-- admin_confirm_deposit_without_receipt (the creator's own auto-confirmed
-- deposit) is left untouched — it never sets enrollment_fee_amount, so it
-- defaults to 0 there. The admin never charges themselves this fee.
-- ============================================================================

alter table groups add column enrollment_fee_amount numeric(12, 2) not null default 0
  check (enrollment_fee_amount >= 0);

-- Only meaningful on type = 'initial_deposit' rows; every other type
-- (penalty/recharge/adjustment/payout) just keeps the 0 default. No
-- cross-column check — nothing else ever writes this column.
alter table wallet_transactions add column enrollment_fee_amount numeric(12, 2) not null default 0
  check (enrollment_fee_amount >= 0);

-- ----------------------------------------------------------------------------
-- create_group: 1 new trailing param. Reproduces the live 19-arg signature,
-- with the same explicit drop-then-recreate already established for this
-- exact class of bug (Postgres identifies a function by its argument TYPE
-- list — adding a param makes this a distinct signature, not a replacement).
-- ----------------------------------------------------------------------------
drop function if exists create_group(
  text, numeric, integer, numeric, numeric, numeric, integer,
  boolean, integer, text, text, integer, jsonb, numeric, date, text, boolean, integer, numeric
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

  return v_group;
end;
$$;

-- ----------------------------------------------------------------------------
-- apply_rule_proposal / apply_rule_change_direct: 1 new coalesce line each,
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
        descenso_penalty_amount = coalesce((v_proposal.proposed_changes ->> 'descenso_penalty_amount')::numeric, g.descenso_penalty_amount),
        enrollment_fee_amount = coalesce((v_proposal.proposed_changes ->> 'enrollment_fee_amount')::numeric, g.enrollment_fee_amount)
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
