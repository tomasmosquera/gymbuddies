-- ============================================================================
-- Removes 4 catalog entries that never got a usable demo image (WorkoutX has
-- no clean match for a plain machine row, and its dataset barely covers
-- cardio machines) and were confirmed unused in any routine/session before
-- this migration was written.
-- ============================================================================
delete from exercises
where slug in ('behind_the_back_cable_curl', 'lat_pulldown_machine_row', 'rowing_machine', 'stair_climber');
