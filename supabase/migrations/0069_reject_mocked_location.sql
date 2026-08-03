-- ============================================================================
-- Anti-cheat: Android exposes a `mocked` flag on the location result when it
-- came from a mock-location provider (a Developer Options toggle, no root
-- needed) — a trivial way to fake being at the gym. The client now reads
-- this flag (useLocationLock.ts) and blocks the check-in screen outright
-- before the camera ever renders. This migration adds the same rejection
-- server-side: both check-in RPCs are public endpoints reachable directly
-- (not just from the app UI), so the client-side block alone is only a UX
-- nicety, not a real gate. A scripted caller that simply always sends
-- p_location_mocked = false isn't stopped by this — that requires a much
-- bigger lift (device attestation) and isn't in scope here. This closes the
-- casual "toggle a fake-GPS app" cheat, which is the one an ordinary member
-- could stumble into from the official app.
-- ============================================================================
create or replace function submit_checkin(
  p_group_id uuid, p_captured_at timestamptz, p_latitude double precision,
  p_longitude double precision, p_location_accuracy_m double precision, p_photo_path text,
  p_location_mocked boolean default false
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_checkin_date date := (p_captured_at at time zone 'America/Bogota')::date;
  v_is_first_today boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can check in';
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;

  select not exists (
    select 1 from checkins
    where group_id = p_group_id and user_id = auth.uid() and checkin_date = v_checkin_date
  ) into v_is_first_today;

  insert into checkins (group_id, user_id, captured_at, latitude, longitude, location_accuracy_m, photo_path)
    values (p_group_id, auth.uid(), p_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_photo_path)
    on conflict (group_id, user_id, checkin_date) do update set
      captured_at = excluded.captured_at,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      location_accuracy_m = excluded.location_accuracy_m,
      photo_path = excluded.photo_path
    returning * into v_checkin;

  if v_is_first_today then
    select * into v_group from groups where id = p_group_id;
    if not v_group.require_checkout_photo then
      select full_name into v_full_name from profiles where id = auth.uid();
      select array_agg(user_id) into v_recipient_ids
        from group_members
        where group_id = p_group_id
          and status in ('pending_deposit', 'active', 'needs_recharge')
          and user_id <> auth.uid();
      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Gym Buddies', format('%s ha subido una foto de su entreno.', v_full_name),
          p_group_id => p_group_id, p_category => 'group_activity'
        );
      end if;
    end if;
  end if;

  return v_checkin;
end;
$$;

create or replace function submit_workout_checkout(
  p_checkin_id uuid, p_captured_at timestamptz, p_latitude double precision,
  p_longitude double precision, p_location_accuracy_m double precision, p_photo_path text,
  p_location_mocked boolean default false
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_is_first_checkout boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;
  if v_checkin.checkin_date <> (now() at time zone 'America/Bogota')::date then
    raise exception 'checkout can only be submitted the same day as the check-in';
  end if;
  if abs(extract(epoch from (now() - p_captured_at))) > 14400 then
    raise exception 'captured_at is too far from server time (clock drift guard)';
  end if;
  if p_captured_at <= v_checkin.captured_at then
    raise exception 'checkout must be after the initial check-in';
  end if;

  v_is_first_checkout := v_checkin.checkout_captured_at is null;

  update checkins
    set checkout_captured_at = p_captured_at,
        checkout_latitude = p_latitude,
        checkout_longitude = p_longitude,
        checkout_location_accuracy_m = p_location_accuracy_m,
        checkout_photo_path = p_photo_path,
        workout_minutes = greatest(round(extract(epoch from (p_captured_at - v_checkin.captured_at)) / 60)::int, 0)
    where id = p_checkin_id
    returning * into v_checkin;

  if v_is_first_checkout then
    select * into v_group from groups where id = v_checkin.group_id;
    if v_group.require_checkout_photo then
      select full_name into v_full_name from profiles where id = auth.uid();
      select array_agg(user_id) into v_recipient_ids
        from group_members
        where group_id = v_checkin.group_id
          and status in ('pending_deposit', 'active', 'needs_recharge')
          and user_id <> auth.uid();
      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Gym Buddies', format('%s ha terminado su entreno de hoy.', v_full_name),
          p_group_id => v_checkin.group_id, p_category => 'group_activity'
        );
      end if;
    end if;
  end if;

  return v_checkin;
end;
$$;
