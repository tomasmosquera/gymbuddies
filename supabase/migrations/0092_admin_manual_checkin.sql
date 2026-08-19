-- ============================================================================
-- Lets a group admin attach real evidence (initial + final photo, location,
-- duration, calories) when marking a day valid from "Asignar día
-- válido/fallado" — instead of (or alongside) the existing bare
-- attendance_overrides flag. Creates an actual checkins row, so it's
-- indistinguishable downstream from a real self-submitted check-in:
-- counts for the leaderboard's duration tiebreak, shows in the Dashboard's
-- Foto Inicial/Final columns, feeds badges/monthly challenges, etc. — no
-- separate bookkeeping needed. "Marcar válido" without evidence keeps using
-- set_attendance_override exactly as before; this is purely additive.
--
-- set_checkin_date's clock-drift guard exists to keep a *member's own*
-- captured_at honest (proof of when THEY took the photo) — it was never
-- meant to block an admin backfilling a past day on someone else's behalf,
-- which by construction never goes through a live camera capture. The only
-- way a checkins row can ever have user_id <> auth.uid() at all is via this
-- new SECURITY DEFINER RPC (checkins_insert_self already pins any direct
-- client insert to user_id = auth.uid()), so gating the relaxed path on
-- exactly that condition is safe and can't be reached any other way.
-- ============================================================================
create or replace function set_checkin_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  select timezone into v_tz from groups where id = new.group_id;
  if tg_op = 'INSERT' or new.captured_at is distinct from old.captured_at then
    if auth.uid() = new.user_id then
      if abs(extract(epoch from (now() - new.captured_at))) > 14400 then
        raise exception 'captured_at is too far from server time (clock drift guard)';
      end if;
    elsif not is_group_admin(new.group_id) then
      raise exception 'only the member themselves can set a recent captured_at, or the group admin for a backfill';
    end if;
  end if;
  new.checkin_date := (new.captured_at at time zone v_tz)::date;
  if tg_op = 'UPDATE' and new.checkin_date <> old.checkin_date then
    raise exception 'a check-in cannot be moved to a different day; take a new one instead';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- admin_create_checkin: fills a gap day with a real, evidenced check-in.
-- Refuses to touch a day that already has one — this is for backfilling a
-- missing day, not editing/overwriting a real submission (see admin-photos
-- for that). captured_at is anchored at local noon (unambiguous checkin_date
-- regardless of DST, no time-of-day field needed from the admin); the
-- checkout time is derived from it by workout_minutes when duration is
-- given, matching the shape submit_workout_checkout produces.
-- ============================================================================
create or replace function admin_create_checkin(
  p_group_id uuid,
  p_user_id uuid,
  p_date date,
  p_photo_path text,
  p_checkout_photo_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_location_accuracy_m double precision default null,
  p_workout_minutes int default null,
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
  v_captured_at := (p_date::text || ' 12:00:00')::timestamp at time zone v_tz;
  v_checkout_captured_at := case
    when p_workout_minutes is not null then v_captured_at + make_interval(mins => p_workout_minutes)
    else null
  end;

  insert into checkins (
    group_id, user_id, captured_at, latitude, longitude, location_accuracy_m, photo_path,
    checkout_captured_at, checkout_latitude, checkout_longitude, checkout_location_accuracy_m, checkout_photo_path,
    workout_minutes, active_energy_kcal
  ) values (
    p_group_id, p_user_id, v_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_photo_path,
    v_checkout_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_checkout_photo_path,
    p_workout_minutes, p_active_energy_kcal
  ) returning * into v_checkin;

  perform send_push_notification(
    array[p_user_id], 'Gym Buddies',
    format('El administrador registró manualmente tu entreno del %s.', to_char(p_date, 'DD/MM/YYYY')),
    p_group_id => p_group_id, p_category => 'admin_actions'
  );

  return v_checkin;
end;
$$;
