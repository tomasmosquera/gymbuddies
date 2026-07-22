-- ============================================================================
-- admin_delete_checkin removed the checkins row but left any
-- attendance_overrides row for that same (group, user, date) untouched. If
-- that date already had a manual 'valid' override (e.g. set earlier via
-- Administrar Miembros, or before this checkin even existed), the day kept
-- counting as completed in both useGroupDayAttendance (dashboard) and
-- run_weekly_evaluation's union of checkins + valid overrides — "deleting
-- the photo" silently did nothing to the day's status. Deleting a check-in
-- should always leave that day as a clean "sin registro", regardless of any
-- override that happened to exist for it — the admin can re-set one
-- afterward if that's genuinely still what they want.
-- ============================================================================
create or replace function admin_delete_checkin(p_checkin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
begin
  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_admin(v_checkin.group_id) then
    raise exception 'only the group admin can delete check-ins';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.photo_path;
  if v_checkin.checkout_photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_photo_path;
  end if;
  delete from checkins where id = p_checkin_id;
  delete from attendance_overrides
    where group_id = v_checkin.group_id and user_id = v_checkin.user_id and override_date = v_checkin.checkin_date;

  perform send_push_notification(
    array[v_checkin.user_id], 'Tu check-in fue eliminado',
    format('El administrador eliminó tu check-in del %s.', to_char(v_checkin.checkin_date, 'DD/MM/YYYY')),
    p_category => 'admin_actions'
  );
end;
$$;
