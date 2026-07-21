-- ============================================================================
-- The admin can now also apply a rule change directly, with no group vote —
-- same coalesce-over-current-value pattern as apply_rule_proposal (so
-- fields the admin leaves blank simply keep their current value), just
-- without ever creating a rule_proposals row. Mirrors the other "admin acts
-- immediately, no vote" precedent already established for attendance
-- overrides (0022).
-- ============================================================================
create or replace function apply_rule_change_direct(p_group_id uuid, p_changes jsonb)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_recipient_ids uuid[];
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can apply rule changes directly';
  end if;

  update groups g
    set min_days_per_week = coalesce((p_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
        penalty_amount = coalesce((p_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
        weekly_penalty_cap = coalesce((p_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
        exit_fee_amount = coalesce((p_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
        exit_notice_days = coalesce((p_changes ->> 'exit_notice_days')::int, g.exit_notice_days),
        require_checkout_photo = coalesce((p_changes ->> 'require_checkout_photo')::boolean, g.require_checkout_photo),
        min_workout_minutes = coalesce((p_changes ->> 'min_workout_minutes')::int, g.min_workout_minutes)
    where g.id = p_group_id
    returning * into v_group;

  if not found then
    raise exception 'group not found';
  end if;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Reglas actualizadas',
      'El administrador actualizó las reglas del grupo directamente, sin necesidad de votación.'
    );
  end if;

  return v_group;
end;
$$;
