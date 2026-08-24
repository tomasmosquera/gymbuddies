-- Dethroned KOTH claim videos (any claim other than the current champion for
-- its exercise) get their storage object removed 1 week after they stopped
-- being champion — the claim ROW itself (weight/reps, user, date, status) is
-- never touched, only the video file, same "record stays, file goes" pattern
-- cleanup_old_checkin_photos already uses for check-in photos (0018/0057).
-- Video display code must already tolerate a missing/expired file the same
-- way it does for those, since old check-in photos already work this way.
--
-- "1 week since stopped being champion" is approximated as 1 week since the
-- CURRENT champion's own claim was created — simpler than tracking each
-- claim's own exact dethroning moment, and safe in the rare
-- dethroned-then-reinstated-via-invalidation-then-dethroned-again case: a
-- claim currently reinstated as champion is by definition excluded (it IS
-- current_claim_id), so it's never deleted while still standing, only once
-- something newer has held the record for a week. If a group's record is
-- vacant (current_claim_id is null — e.g. the champion deleted their
-- account), each dethroned claim falls back to 1 week since its own
-- created_at instead.
create or replace function cleanup_dethroned_koth_videos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
    where bucket_id = 'koth-videos'
      and name in (
        select c.video_path
        from koth_claims c
        join koth_records r on r.group_id = c.group_id and r.exercise_id = c.exercise_id
        where (r.current_claim_id is null or c.id <> r.current_claim_id)
          and now() - coalesce(
            (select cc.created_at from koth_claims cc where cc.id = r.current_claim_id),
            c.created_at
          ) > interval '7 days'
      );
end;
$$;

select cron.schedule(
  'cleanup-dethroned-koth-videos',
  '30 8 * * *', -- 03:30 America/Bogota daily
  $$select cleanup_dethroned_koth_videos();$$
);
