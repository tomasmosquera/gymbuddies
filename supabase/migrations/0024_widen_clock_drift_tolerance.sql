-- ============================================================================
-- The clock-drift guard exists to catch a manipulated device clock, not to
-- police how long a member takes between snapping a photo and confirming
-- it in the app. 10 minutes proved too tight for real usage — especially
-- checkout, where finishing a workout, getting the phone out, waiting for
-- GPS lock, and reviewing the photo before confirming easily adds up to
-- more than that. Widened to 30 minutes on both the check-in and checkout
-- paths (same mechanism, same fix needed in both places).
-- ============================================================================
create or replace function set_checkin_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if abs(extract(epoch from (now() - new.captured_at))) > 1800 then
    raise exception 'captured_at is too far from server time (clock drift guard)';
  end if;
  new.checkin_date := (new.captured_at at time zone 'America/Bogota')::date;
  if tg_op = 'UPDATE' and new.checkin_date <> old.checkin_date then
    raise exception 'a check-in cannot be moved to a different day; take a new one instead';
  end if;
  return new;
end;
$$;

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
  if abs(extract(epoch from (now() - p_captured_at))) > 1800 then
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
