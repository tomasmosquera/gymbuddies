-- ============================================================================
-- admin_create_checkin (0092) took a bare duration in minutes; the admin now
-- picks explicit start/end times instead, so this recomputes captured_at/
-- checkout_captured_at from real wall-clock times instead of an offset.
-- p_start_time still defaults to null, in which case captured_at keeps the
-- original local-noon anchor (0092) — an admin who doesn't care about exact
-- timing can still skip it entirely, same as before. workout_minutes is now
-- derived from the two timestamps instead of being a caller-supplied number.
-- Changing the parameter list requires dropping the old signature first —
-- create or replace never removes a signature once the params themselves
-- change (see 0091's cleanup of stale create_group overloads for the same
-- lesson).
-- ============================================================================
drop function if exists admin_create_checkin(
  uuid, uuid, date, text, text, double precision, double precision, double precision, int, numeric
);

create or replace function admin_create_checkin(
  p_group_id uuid,
  p_user_id uuid,
  p_date date,
  p_photo_path text,
  p_checkout_photo_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_location_accuracy_m double precision default null,
  p_start_time time default null,
  p_end_time time default null,
  p_active_energy_kcal numeric default null
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_captured_at timestamptz;
  v_checkout_captured_at timestamptz;
  v_workout_minutes int;
  v_checkin checkins%rowtype;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can create a manual check-in';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'user is not a member of this group';
  end if;
  if exists (select 1 from checkins where group_id = p_group_id and user_id = p_user_id and checkin_date = p_date) then
    raise exception 'this member already has a check-in on this date — edit it from Moderar Fotos instead';
  end if;

  select timezone into v_tz from groups where id = p_group_id;
  v_captured_at := (p_date::text || ' ' || coalesce(p_start_time::text, '12:00:00'))::timestamp at time zone v_tz;
  v_checkout_captured_at := case
    when p_end_time is not null then
      (p_date::text || ' ' || p_end_time::text)::timestamp at time zone v_tz
        + case when p_start_time is not null and p_end_time < p_start_time then interval '1 day' else interval '0' end
    else null
  end;
  v_workout_minutes := case
    when v_checkout_captured_at is not null then round(extract(epoch from (v_checkout_captured_at - v_captured_at)) / 60)
    else null
  end;

  insert into checkins (
    group_id, user_id, captured_at, latitude, longitude, location_accuracy_m, photo_path,
    checkout_captured_at, checkout_latitude, checkout_longitude, checkout_location_accuracy_m, checkout_photo_path,
    workout_minutes, active_energy_kcal
  ) values (
    p_group_id, p_user_id, v_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_photo_path,
    v_checkout_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_checkout_photo_path,
    v_workout_minutes, p_active_energy_kcal
  ) returning * into v_checkin;

  perform send_push_notification(
    array[p_user_id], 'Gym Buddies',
    format('El administrador registró manualmente tu entreno del %s.', to_char(p_date, 'DD/MM/YYYY')),
    p_group_id => p_group_id, p_category => 'admin_actions'
  );

  return v_checkin;
end;
$$;
