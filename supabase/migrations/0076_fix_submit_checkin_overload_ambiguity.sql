-- ============================================================================
-- Bug fix: 0074 added p_auto_created to submit_checkin/submit_workout_checkout
-- via `create or replace function`, but a new parameter changes the
-- function's signature (Postgres identifies overloads by argument list, not
-- name) — so 0074 didn't replace the previous version, it created a THIRD
-- overload alongside two older ones already lying around (a 6-arg version
-- from before p_location_mocked existed, and the 7-arg version from when
-- p_location_mocked was added — same mistake, never cleaned up then either).
--
-- The app calls both functions without p_auto_created (that argument is
-- only ever passed by the new fan-out logic) — with three overloads on
-- file, that 7-named-argument call became ambiguous between the 7-arg and
-- 8-arg versions (p_auto_created's default makes the 8-arg one also match),
-- and every real check-in started failing with "Could not choose the best
-- candidate function." Dropping every prior signature leaves exactly one
-- overload per function, matching the established pattern this codebase
-- already uses elsewhere for signature changes (e.g. create_group's 8-arg
-- drop, noted in 0023).
-- ============================================================================
drop function if exists submit_checkin(uuid, timestamptz, double precision, double precision, double precision, text);
drop function if exists submit_checkin(uuid, timestamptz, double precision, double precision, double precision, text, boolean);
drop function if exists submit_workout_checkout(uuid, timestamptz, double precision, double precision, double precision, text);
drop function if exists submit_workout_checkout(uuid, timestamptz, double precision, double precision, double precision, text, boolean);
