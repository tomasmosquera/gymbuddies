-- ============================================================================
-- enrollment_fee_amount must only ever change via the admin's direct-apply
-- path (apply_rule_change_direct, already gated by is_group_admin) — never
-- as the outcome of a group vote. 0105 added it to BOTH apply_rule_proposal
-- (the vote-outcome applier) and apply_rule_change_direct; this removes it
-- from apply_rule_proposal only, so even a proposal whose JSON happened to
-- include this key (however it got there) silently has no effect on this
-- column once a vote passes — a real server-side guarantee, not just a
-- client-side UI omission (the client is also being updated separately to
-- only ever show/submit this field from the admin's direct-apply screen).
-- ============================================================================

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
        -- enrollment_fee_amount deliberately excluded — see header comment.
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
