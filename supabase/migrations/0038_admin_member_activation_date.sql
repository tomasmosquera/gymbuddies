-- ============================================================================
-- admin_set_member_activation_date: lets the admin correct the date from
-- which a member's days start counting (group_members.activated_at), which
-- run_weekly_evaluation() already reads (falling back to joined_at if null —
-- see 0012_partial_week_and_recapture.sql) but had no way to edit directly.
-- Same shape as every other admin-direct RPC this session: admin-only,
-- notifies the affected member.
-- ============================================================================
create or replace function admin_set_member_activation_date(p_member_id uuid, p_date date)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
begin
  select * into v_member from group_members where id = p_member_id;
  if not found then
    raise exception 'member not found';
  end if;
  if not is_group_admin(v_member.group_id) then
    raise exception 'only the group admin can change a member''s activation date';
  end if;

  update group_members
    set activated_at = (p_date::timestamp) at time zone 'America/Bogota'
    where id = p_member_id
    returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Tu fecha de entrada cambió',
    format('El administrador ajustó la fecha desde la que cuentan tus días a partir del %s.', to_char(p_date, 'DD/MM/YYYY'))
  );

  return v_member;
end;
$$;
