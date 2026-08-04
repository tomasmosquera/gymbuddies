-- ============================================================================
-- Auto check-in fan-out: when enabled (default on, user-toggleable), a
-- check-in/checkout done in one group also gets created in every other
-- group the user actively belongs to — the actual photo is re-uploaded per
-- group client-side (checkins' storage RLS scopes read access by the
-- group_id folder segment of the path, so one group's members can never
-- read another group's photo file — reusing one path across groups would
-- silently break photo viewing for the other groups' members).
--
-- auto_created marks which rows THIS fan-out created, so it can tell its
-- own rows apart from a member's genuinely separate real check-in that
-- already existed that day in another group — the latter must never be
-- touched (confirmed requirement: "se respeta el que ya existía").
-- p_auto_created on both RPCs lets the client mark which calls are fan-out
-- vs. the primary/direct submission; the guards below make this safe even
-- if the client ever got that flag wrong, not just a UI-level courtesy.
-- ============================================================================
alter table checkins add column auto_created boolean not null default false;
alter table profiles add column auto_checkin_other_groups boolean not null default true;

create or replace function submit_checkin(
  p_group_id uuid, p_captured_at timestamptz, p_latitude double precision,
  p_longitude double precision, p_location_accuracy_m double precision, p_photo_path text,
  p_location_mocked boolean default false,
  p_auto_created boolean default false
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_tz text;
  v_checkin_date date;
  v_is_first_today boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
  v_existing_manual boolean;
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can check in';
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;

  select * into v_group from groups where id = p_group_id;
  v_tz := v_group.timezone;
  v_checkin_date := (p_captured_at at time zone v_tz)::date;

  if p_auto_created then
    select exists (
      select 1 from checkins
      where group_id = p_group_id and user_id = auth.uid() and checkin_date = v_checkin_date and not auto_created
    ) into v_existing_manual;
    if v_existing_manual then
      return null;
    end if;
  end if;

  select not exists (
    select 1 from checkins
    where group_id = p_group_id and user_id = auth.uid() and checkin_date = v_checkin_date
  ) into v_is_first_today;

  insert into checkins (
    group_id, user_id, captured_at, latitude, longitude, location_accuracy_m, photo_path, auto_created
  )
    values (
      p_group_id, auth.uid(), p_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_photo_path, p_auto_created
    )
    on conflict (group_id, user_id, checkin_date) do update set
      captured_at = excluded.captured_at,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      location_accuracy_m = excluded.location_accuracy_m,
      photo_path = excluded.photo_path,
      auto_created = excluded.auto_created
    returning * into v_checkin;

  if v_is_first_today then
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
  p_location_mocked boolean default false,
  p_auto_created boolean default false
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_tz text;
  v_is_first_checkout boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;
  if p_auto_created and not v_checkin.auto_created then
    return null;
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;

  select timezone into v_tz from groups where id = v_checkin.group_id;
  if v_checkin.checkin_date <> (now() at time zone v_tz)::date then
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

create or replace function set_auto_checkin_other_groups(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set auto_checkin_other_groups = p_enabled where id = auth.uid();
end;
$$;
