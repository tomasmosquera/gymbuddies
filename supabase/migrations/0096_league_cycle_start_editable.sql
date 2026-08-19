-- ============================================================================
-- league_cycles.started_at (Liga/Mixto podium timing) is conceptually
-- distinct from groups.game_starts_at (the group-wide "nothing counts before
-- this" floor, deliberately NOT proposable — see 0088). This lets the
-- currently-running cycle's start date be moved: proposable as a rule change
-- (vote or direct-apply, like every other league field), and directly
-- editable by the admin from Administrar Grupo without a vote, same pattern
-- as admin_set_group_public / the timezone field there.
-- set_running_league_cycle_start is the shared helper both paths call —
-- silently no-ops (returns null) if there's no running cycle, matching the
-- coalesce-style leniency the other rule-change fields already have; the
-- direct admin RPC turns that into an explicit error instead, since a
-- one-click button deserves real feedback.
-- ============================================================================
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
        ends_at = v_new_started_at + (v_cycle.duration_months || ' months')::interval
    where id = v_cycle.id
    returning * into v_cycle;

  return v_cycle;
end;
$$;

create or replace function admin_set_league_cycle_start(p_group_id uuid, p_started_at date)
returns league_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle league_cycles%rowtype;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can change the league cycle start date';
  end if;

  v_cycle := set_running_league_cycle_start(p_group_id, p_started_at);
  if v_cycle.id is null then
    raise exception 'no hay un ciclo de liga corriendo actualmente';
  end if;

  return v_cycle;
end;
$$;

-- Reproduces 0088's bodies (the last version of these two), adding the
-- league_cycle_started_at branch after the groups update.
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
        mixed_league_share_percent = coalesce((v_proposal.proposed_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent)
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
        mixed_league_share_percent = coalesce((p_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent)
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
