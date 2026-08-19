-- ============================================================================
-- admin_set_excused_day: lets the admin excuse a single day (médico/viaje)
-- for a member directly from "Asignar día válido/fallado", without the
-- member having to submit a request first. excuse_dates.excuse_request_id
-- is NOT NULL (every excused date traces back to a decided request — see
-- 0014), so this still creates a real excuse_requests row underneath,
-- already 'approved' with decided_by/decided_at set to this admin action —
-- same audit trail shape as approve_excuse_request, just admin-initiated
-- instead of member-initiated, and single-day instead of a range. No proof
-- required, same as "Marcar válido/fallado" already requires none — the
-- admin's own judgment is the evidence here, exactly like those.
-- 'other' is deliberately not offered: that type always means a group vote
-- elsewhere in the app, which doesn't fit a direct one-click admin action.
-- ============================================================================
create or replace function admin_set_excused_day(
  p_group_id uuid,
  p_user_id uuid,
  p_date date,
  p_excuse_type text,
  p_note text default null
)
returns excuse_dates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_excused excuse_dates%rowtype;
  v_excuse_type_label text;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can mark a day excused';
  end if;
  if p_excuse_type not in ('travel', 'medical') then
    raise exception 'invalid excuse type';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'user is not a member of this group';
  end if;
  if exists (select 1 from checkins where group_id = p_group_id and user_id = p_user_id and checkin_date = p_date) then
    raise exception 'this member already has a check-in on this date';
  end if;
  if exists (select 1 from excuse_dates where group_id = p_group_id and user_id = p_user_id and excused_date = p_date) then
    raise exception 'this date is already excused';
  end if;

  insert into excuse_requests (
    group_id, user_id, excuse_type, requested_start_date, requested_end_date, reason,
    status, decision_note, decided_by, decided_at
  ) values (
    p_group_id, p_user_id, p_excuse_type, p_date, p_date, p_note,
    'approved', p_note, auth.uid(), now()
  ) returning * into v_request;

  insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
    values (v_request.id, p_group_id, p_user_id, p_date)
    returning * into v_excused;

  v_excuse_type_label := case p_excuse_type when 'travel' then 'viaje' else 'médica' end;
  perform send_push_notification(
    array[p_user_id], 'Gym Buddies',
    format('El administrador marcó el %s como excusado (%s).', to_char(p_date, 'DD/MM/YYYY'), v_excuse_type_label),
    p_group_id => p_group_id, p_category => 'admin_actions'
  );

  return v_excused;
end;
$$;
