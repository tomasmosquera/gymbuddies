-- ============================================================================
-- Check-in/checkout video thumbnail: the Dashboard/Moderar fotos tile was
-- generating a frame live every time it rendered (expo-video's
-- generateThumbnailsAsync against the REMOTE signed video URL) — slow,
-- since it has to buffer enough of the actual video stream over the network
-- before a frame is available, unlike a photo which just IS the small image
-- already. This stores a small JPEG thumbnail (captured once, from the
-- LOCAL file, right after recording — see preview.tsx's VideoThumbnailCapture)
-- alongside the video, so the tile can just load it like a normal photo.
-- Nullable and best-effort: a video with no thumbnail yet (older check-ins,
-- or a capture that failed/timed out) still works, just falls back to the
-- slower live-generation path client-side.
-- ============================================================================

alter table checkins add column video_thumbnail_path text;
alter table checkins add column checkout_video_thumbnail_path text;

-- ----------------------------------------------------------------------------
-- submit_checkin: adds p_video_thumbnail_path. Same drop-first treatment as
-- 0165/0076 — a parameter count change needs the old signature dropped
-- first, or create or replace just adds a second, ambiguous overload.
-- ----------------------------------------------------------------------------
drop function if exists submit_checkin(uuid, timestamptz, double precision, double precision, double precision, text, boolean, boolean, text);

create or replace function submit_checkin(
  p_group_id uuid, p_captured_at timestamptz, p_latitude double precision,
  p_longitude double precision, p_location_accuracy_m double precision,
  p_photo_path text default null,
  p_location_mocked boolean default false,
  p_auto_created boolean default false,
  p_video_path text default null,
  p_video_thumbnail_path text default null
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
  v_had_failed_override boolean;
  v_old_checkout_photo_path text;
  v_old_checkout_video_path text;
  v_old_checkout_video_thumbnail_path text;
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can check in';
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;
  if (p_photo_path is null) = (p_video_path is null) then
    raise exception 'submit_checkin requires exactly one of p_photo_path or p_video_path';
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

  select exists (
    select 1 from attendance_overrides
    where group_id = p_group_id and user_id = auth.uid() and override_date = v_checkin_date and status = 'failed'
  ) into v_had_failed_override;
  if v_had_failed_override then
    select checkout_photo_path, checkout_video_path, checkout_video_thumbnail_path
      into v_old_checkout_photo_path, v_old_checkout_video_path, v_old_checkout_video_thumbnail_path
      from checkins where group_id = p_group_id and user_id = auth.uid() and checkin_date = v_checkin_date;
  end if;

  select not exists (
    select 1 from checkins
    where group_id = p_group_id and user_id = auth.uid() and checkin_date = v_checkin_date
  ) into v_is_first_today;

  insert into checkins (
    group_id, user_id, captured_at, latitude, longitude, location_accuracy_m,
    photo_path, video_path, video_thumbnail_path, auto_created
  )
    values (
      p_group_id, auth.uid(), p_captured_at, p_latitude, p_longitude, p_location_accuracy_m,
      p_photo_path, p_video_path, p_video_thumbnail_path, p_auto_created
    )
    on conflict (group_id, user_id, checkin_date) do update set
      captured_at = excluded.captured_at,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      location_accuracy_m = excluded.location_accuracy_m,
      photo_path = excluded.photo_path,
      video_path = excluded.video_path,
      video_thumbnail_path = excluded.video_thumbnail_path,
      auto_created = excluded.auto_created,
      checkout_captured_at = case when v_had_failed_override then null else checkins.checkout_captured_at end,
      checkout_latitude = case when v_had_failed_override then null else checkins.checkout_latitude end,
      checkout_longitude = case when v_had_failed_override then null else checkins.checkout_longitude end,
      checkout_location_accuracy_m = case when v_had_failed_override then null else checkins.checkout_location_accuracy_m end,
      checkout_photo_path = case when v_had_failed_override then null else checkins.checkout_photo_path end,
      checkout_video_path = case when v_had_failed_override then null else checkins.checkout_video_path end,
      checkout_video_thumbnail_path = case when v_had_failed_override then null else checkins.checkout_video_thumbnail_path end,
      workout_minutes = case when v_had_failed_override then null else checkins.workout_minutes end,
      active_energy_kcal = case when v_had_failed_override then null else checkins.active_energy_kcal end
    returning * into v_checkin;

  if v_had_failed_override then
    perform set_config('storage.allow_delete_query', 'true', true);
    if v_old_checkout_photo_path is not null then
      delete from storage.objects where bucket_id = 'checkins' and name = v_old_checkout_photo_path;
    end if;
    if v_old_checkout_video_path is not null then
      delete from storage.objects where bucket_id = 'checkins' and name = v_old_checkout_video_path;
    end if;
    if v_old_checkout_video_thumbnail_path is not null then
      delete from storage.objects where bucket_id = 'checkins' and name = v_old_checkout_video_thumbnail_path;
    end if;
    delete from attendance_overrides
      where group_id = p_group_id and user_id = auth.uid() and override_date = v_checkin_date and status = 'failed';
  end if;

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

-- ----------------------------------------------------------------------------
-- submit_workout_checkout: same p_video_thumbnail_path addition, same
-- drop-first treatment.
-- ----------------------------------------------------------------------------
drop function if exists submit_workout_checkout(uuid, timestamptz, double precision, double precision, double precision, text, boolean, boolean, text);

create or replace function submit_workout_checkout(
  p_checkin_id uuid, p_captured_at timestamptz, p_latitude double precision,
  p_longitude double precision, p_location_accuracy_m double precision,
  p_photo_path text default null,
  p_location_mocked boolean default false,
  p_auto_created boolean default false,
  p_video_path text default null,
  p_video_thumbnail_path text default null
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
  if p_auto_created and v_checkin.checkout_captured_at is not null then
    return null;
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;
  if (p_photo_path is null) = (p_video_path is null) then
    raise exception 'submit_workout_checkout requires exactly one of p_photo_path or p_video_path';
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
        checkout_video_path = p_video_path,
        checkout_video_thumbnail_path = p_video_thumbnail_path,
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

-- ----------------------------------------------------------------------------
-- delete_own_checkin / admin_delete_checkin: also clean up the thumbnail
-- storage objects. Neither function's parameter list changes, so create or
-- replace is safe here (no drop needed).
-- ----------------------------------------------------------------------------
create or replace function delete_own_checkin(p_checkin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_tz text;
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;

  select timezone into v_tz from groups where id = v_checkin.group_id;
  if v_checkin.checkin_date <> (now() at time zone v_tz)::date then
    raise exception 'solo puedes eliminar el check-in de hoy';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  if v_checkin.photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.photo_path;
  end if;
  if v_checkin.video_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.video_path;
  end if;
  if v_checkin.video_thumbnail_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.video_thumbnail_path;
  end if;
  if v_checkin.checkout_photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_photo_path;
  end if;
  if v_checkin.checkout_video_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_video_path;
  end if;
  if v_checkin.checkout_video_thumbnail_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_video_thumbnail_path;
  end if;
  delete from checkins where id = p_checkin_id;
end;
$$;

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
  if v_checkin.photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.photo_path;
  end if;
  if v_checkin.video_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.video_path;
  end if;
  if v_checkin.video_thumbnail_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.video_thumbnail_path;
  end if;
  if v_checkin.checkout_photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_photo_path;
  end if;
  if v_checkin.checkout_video_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_video_path;
  end if;
  if v_checkin.checkout_video_thumbnail_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_video_thumbnail_path;
  end if;
  delete from checkins where id = p_checkin_id;
  delete from attendance_overrides
    where group_id = v_checkin.group_id and user_id = v_checkin.user_id and override_date = v_checkin.checkin_date;

  perform send_push_notification(
    array[v_checkin.user_id], 'Tu check-in fue eliminado',
    format('El administrador eliminó tu check-in del %s.', to_char(v_checkin.checkin_date, 'DD/MM/YYYY')),
    p_group_id => v_checkin.group_id, p_category => 'admin_actions'
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_replace_checkin_photo: also clears (and deletes) the video thumbnail
-- whenever the video side it belongs to is cleared — same reasoning as the
-- video_path clear this function already does (0165).
-- ----------------------------------------------------------------------------
create or replace function admin_replace_checkin_photo(p_checkin_id uuid, p_which text, p_photo_path text)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_old_path text;
  v_old_video_path text;
  v_old_video_thumbnail_path text;
  v_label text;
begin
  if p_which not in ('initial', 'final') then
    raise exception 'invalid photo selector';
  end if;

  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_admin(v_checkin.group_id) then
    raise exception 'only the group admin can replace a check-in photo';
  end if;
  if p_which = 'final' and v_checkin.checkout_photo_path is null and v_checkin.checkout_video_path is null then
    raise exception 'this check-in has no final photo yet';
  end if;

  if p_which = 'initial' then
    v_old_path := v_checkin.photo_path;
    v_old_video_path := v_checkin.video_path;
    v_old_video_thumbnail_path := v_checkin.video_thumbnail_path;
    update checkins set photo_path = p_photo_path, video_path = null, video_thumbnail_path = null
      where id = p_checkin_id returning * into v_checkin;
  else
    v_old_path := v_checkin.checkout_photo_path;
    v_old_video_path := v_checkin.checkout_video_path;
    v_old_video_thumbnail_path := v_checkin.checkout_video_thumbnail_path;
    update checkins set checkout_photo_path = p_photo_path, checkout_video_path = null, checkout_video_thumbnail_path = null
      where id = p_checkin_id returning * into v_checkin;
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  if v_old_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_old_path;
  end if;
  if v_old_video_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_old_video_path;
  end if;
  if v_old_video_thumbnail_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_old_video_thumbnail_path;
  end if;

  v_label := case p_which when 'initial' then 'inicial' else 'final' end;
  perform send_push_notification(
    array[v_checkin.user_id], 'Gym Buddies',
    format('El administrador reemplazó tu foto %s del %s.', v_label, to_char(v_checkin.checkin_date, 'DD/MM/YYYY')),
    p_group_id => v_checkin.group_id, p_category => 'admin_actions'
  );

  return v_checkin;
end;
$$;

-- ----------------------------------------------------------------------------
-- cleanup_old_checkin_photos: sweep the two new thumbnail columns on the
-- same cutoff as every other checkin media column (see 0057's own doc
-- comment for the exact weekday math — unchanged here).
-- ----------------------------------------------------------------------------
create or replace function cleanup_old_checkin_photos()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
begin
  perform set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects
    where bucket_id = 'checkins'
      and name in (
        select photo_path from checkins
          where photo_path is not null
            and (
              (extract(isodow from checkin_date) in (6, 7)
                and v_today >= date_trunc('week', checkin_date)::date + 9)
              or
              (extract(isodow from checkin_date) between 1 and 5
                and v_today >= date_trunc('week', checkin_date)::date + 7)
            )
        union all
        select video_path from checkins
          where video_path is not null
            and (
              (extract(isodow from checkin_date) in (6, 7)
                and v_today >= date_trunc('week', checkin_date)::date + 9)
              or
              (extract(isodow from checkin_date) between 1 and 5
                and v_today >= date_trunc('week', checkin_date)::date + 7)
            )
        union all
        select video_thumbnail_path from checkins
          where video_thumbnail_path is not null
            and (
              (extract(isodow from checkin_date) in (6, 7)
                and v_today >= date_trunc('week', checkin_date)::date + 9)
              or
              (extract(isodow from checkin_date) between 1 and 5
                and v_today >= date_trunc('week', checkin_date)::date + 7)
            )
        union all
        select checkout_photo_path from checkins
          where checkout_photo_path is not null
            and (
              (extract(isodow from checkin_date) in (6, 7)
                and v_today >= date_trunc('week', checkin_date)::date + 9)
              or
              (extract(isodow from checkin_date) between 1 and 5
                and v_today >= date_trunc('week', checkin_date)::date + 7)
            )
        union all
        select checkout_video_path from checkins
          where checkout_video_path is not null
            and (
              (extract(isodow from checkin_date) in (6, 7)
                and v_today >= date_trunc('week', checkin_date)::date + 9)
              or
              (extract(isodow from checkin_date) between 1 and 5
                and v_today >= date_trunc('week', checkin_date)::date + 7)
            )
        union all
        select checkout_video_thumbnail_path from checkins
          where checkout_video_thumbnail_path is not null
            and (
              (extract(isodow from checkin_date) in (6, 7)
                and v_today >= date_trunc('week', checkin_date)::date + 9)
              or
              (extract(isodow from checkin_date) between 1 and 5
                and v_today >= date_trunc('week', checkin_date)::date + 7)
            )
      );

  delete from storage.objects
    where bucket_id = 'receipts'
      and name in (
        select receipt_path from wallet_transactions
          where receipt_path is not null
            and (
              (extract(isodow from (created_at at time zone 'America/Bogota')::date) in (6, 7)
                and v_today >= date_trunc('week', (created_at at time zone 'America/Bogota')::date)::date + 9)
              or
              (extract(isodow from (created_at at time zone 'America/Bogota')::date) between 1 and 5
                and v_today >= date_trunc('week', (created_at at time zone 'America/Bogota')::date)::date + 7)
            )
      );

  delete from storage.objects
    where bucket_id = 'excuse-proofs'
      and name in (
        select proof_path from excuse_requests
          where proof_path is not null
            and (
              (extract(isodow from (created_at at time zone 'America/Bogota')::date) in (6, 7)
                and v_today >= date_trunc('week', (created_at at time zone 'America/Bogota')::date)::date + 9)
              or
              (extract(isodow from (created_at at time zone 'America/Bogota')::date) between 1 and 5
                and v_today >= date_trunc('week', (created_at at time zone 'America/Bogota')::date)::date + 7)
            )
      );
end;
$$;
