-- Lets the group admin correct a check-in's workout duration (e.g. it was
-- entered manually and needs a fix, or the checkout photo timestamp was off).
-- Deliberately silent — no push notification, unlike admin_delete_checkin —
-- since this is a minor bookkeeping correction, not something the member
-- needs to be told about.
create or replace function admin_set_checkin_workout_minutes(p_checkin_id uuid, p_workout_minutes integer)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
begin
  if p_workout_minutes < 0 or p_workout_minutes > 1440 then
    raise exception 'workout minutes must be between 0 and 1440';
  end if;

  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_admin(v_checkin.group_id) then
    raise exception 'only the group admin can edit a check-in''s workout duration';
  end if;

  update checkins set workout_minutes = p_workout_minutes where id = p_checkin_id returning * into v_checkin;

  return v_checkin;
end;
$$;
