-- ============================================================================
-- Notify the rest of the group when a teammate logs their workout for the
-- day. Which photo counts as "done" depends on the group's own rule:
--   - require_checkout_photo = true  -> notify on the FINAL (checkout) photo,
--     since that's the one that actually closes out the day for this group.
--   - require_checkout_photo = false -> notify on the INITIAL (check-in)
--     photo instead, since there's no checkout step to wait for.
-- Both submit_checkin and submit_workout_checkout already have every value
-- needed (the acting user, the group's rule, the exact row just written) in
-- the same statement, so this is built the same way every other
-- notification in this app is: inline in the RPC, no separate job.
--
-- Guarded to fire only on the *first* photo of its kind for that checkin —
-- submit_checkin upserts on same-day retakes and submit_workout_checkout
-- could in principle be called again, and a retake shouldn't re-spam the
-- group with "fulano subió una foto" every time someone reshoots it.
-- ============================================================================
create or replace function submit_checkin(
  p_group_id uuid,
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
  v_checkin_date date := (p_captured_at at time zone 'America/Bogota')::date;
  v_is_first_today boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can check in';
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
          v_recipient_ids, 'Gym Buddies', format('%s ha subido una foto de su entreno.', v_full_name)
        );
      end if;
    end if;
  end if;

  return v_checkin;
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
  v_is_first_checkout boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
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
          v_recipient_ids, 'Gym Buddies', format('%s ha terminado su entreno de hoy.', v_full_name)
        );
      end if;
    end if;
  end if;

  return v_checkin;
end;
$$;
