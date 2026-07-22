-- ============================================================================
-- Empirical correction: I'd assumed photo_challenges.target_user_id would
-- never actually block a delete, since it always equals the challenged
-- check-in's own user_id and checkins.user_id already cascades from
-- profiles — reasoning that the challenge row would already be gone via
-- checkin_id's own cascade before target_user_id's constraint was checked.
-- Tested against a real disposable account and that's wrong: Postgres does
-- not guarantee the checkin_id cascade resolves before target_user_id's own
-- direct (NO ACTION) FK against profiles is checked, so deleting the
-- account of anyone who has ever been the target of a photo challenge
-- failed with a live constraint violation. Cascading it directly is also
-- the more correct design anyway: if the challenged person's account goes,
-- the whole challenge record (fundamentally about their check-in) should
-- go with it, same as the check-in itself already does.
-- ============================================================================
alter table photo_challenges drop constraint photo_challenges_target_user_id_fkey;
alter table photo_challenges add constraint photo_challenges_target_user_id_fkey
  foreign key (target_user_id) references profiles (id) on delete cascade;
