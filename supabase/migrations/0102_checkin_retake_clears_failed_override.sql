-- ============================================================================
-- Bug fix, real incident: a member's photo got invalidated (photo challenge
-- vote, or a direct admin override) — 'failed' attendance_overrides always
-- wins over a check-in in classifyMemberDay, by design (src/lib/domain/
-- attendance.ts), so the day showed failed. The member then retook their
-- initial photo (submit_checkin's ON CONFLICT DO UPDATE path, same
-- group/user/checkin_date) with a genuinely valid new session — but two
-- things went wrong:
--
--   1. The retake only ever touched captured_at/latitude/longitude/
--      location_accuracy_m/photo_path/auto_created — checkout_captured_at,
--      the checkout photo, workout_minutes and active_energy_kcal all
--      stayed exactly as they were from the invalidated session. Observed:
--      a member's tennis photo got voted invalid, he retook his initial
--      photo for real this time (now at the gym), and the app kept showing
--      the *tennis* final photo, since nothing had reset it.
--   2. Nothing ever cleared the 'failed' override itself, so even with a
--      brand new, perfectly legitimate check-in in place, the day stayed
--      marked failed forever — the member had no way to actually recover
--      from an invalidation.
--
-- Fix: when this call's (group_id, user_id, checkin_date) currently has a
-- 'failed' override, treat the submission as starting that day over from
-- scratch — reset every checkout-half field to null (so the group's
-- "Foto Final" step is asked for again, same as a brand-new day) and delete
-- the 'failed' override, so the new check-in counts once it's in place (and
-- can be challenged again by the group if anyone doubts *this* one, same as
-- any other check-in). Scoped to this exact group — a group where the
-- original session was never invalidated (e.g. the auto-fan-out copy in
-- another group, where the vote never happened) has no 'failed' override to
-- begin with, so it's untouched and keeps its own original photos.
-- ============================================================================
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
  v_had_failed_override boolean;
  v_old_checkout_photo_path text;
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

  select exists (
    select 1 from attendance_overrides
    where group_id = p_group_id and user_id = auth.uid() and override_date = v_checkin_date and status = 'failed'
  ) into v_had_failed_override;
  if v_had_failed_override then
    select checkout_photo_path into v_old_checkout_photo_path
      from checkins where group_id = p_group_id and user_id = auth.uid() and checkin_date = v_checkin_date;
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
      auto_created = excluded.auto_created,
      checkout_captured_at = case when v_had_failed_override then null else checkins.checkout_captured_at end,
      checkout_latitude = case when v_had_failed_override then null else checkins.checkout_latitude end,
      checkout_longitude = case when v_had_failed_override then null else checkins.checkout_longitude end,
      checkout_location_accuracy_m = case when v_had_failed_override then null else checkins.checkout_location_accuracy_m end,
      checkout_photo_path = case when v_had_failed_override then null else checkins.checkout_photo_path end,
      workout_minutes = case when v_had_failed_override then null else checkins.workout_minutes end,
      active_energy_kcal = case when v_had_failed_override then null else checkins.active_energy_kcal end
    returning * into v_checkin;

  if v_had_failed_override then
    if v_old_checkout_photo_path is not null then
      perform set_config('storage.allow_delete_query', 'true', true);
      delete from storage.objects where bucket_id = 'checkins' and name = v_old_checkout_photo_path;
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
