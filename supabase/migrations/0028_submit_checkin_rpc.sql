-- ============================================================================
-- Root cause of "permission denied for table checkins" on a same-day retake:
-- the client's .upsert(...) generates `INSERT ... ON CONFLICT (group_id,
-- user_id, checkin_date) DO UPDATE SET group_id = excluded.group_id,
-- user_id = excluded.user_id, ...` — PostgREST's merge-duplicates includes
-- every payload column in the SET list, including the conflict-target
-- columns themselves, which are NOT part of the narrow column grant from
-- 0012 (captured_at, latitude, longitude, location_accuracy_m, photo_path).
-- A fresh check-in (plain INSERT, no conflict) never hit this, which is why
-- it went unnoticed until a real same-day retake happened.
--
-- Fixed exactly like submit_workout_checkout already was (0023's own
-- comment even calls this out: "as an RPC instead of a wider column grant")
-- — move the write behind a SECURITY DEFINER RPC, which bypasses grants
-- entirely, and revoke the client's direct insert/update access since
-- nothing else writes to checkins directly anymore.
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
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can check in';
  end if;

  insert into checkins (group_id, user_id, captured_at, latitude, longitude, location_accuracy_m, photo_path)
    values (p_group_id, auth.uid(), p_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_photo_path)
    on conflict (group_id, user_id, checkin_date) do update set
      captured_at = excluded.captured_at,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      location_accuracy_m = excluded.location_accuracy_m,
      photo_path = excluded.photo_path
    returning * into v_checkin;

  return v_checkin;
end;
$$;

drop policy if exists checkins_insert_self on checkins;
drop policy if exists checkins_update_self_today on checkins;
revoke insert, update on checkins from authenticated;
