-- ============================================================================
-- Active energy (calories) burned during a workout, sourced from Apple
-- Health (HealthKit) — see the plan under discussion. Nullable and purely
-- informational: never used for penalties, ranking, or badges, same as
-- workout_minutes duration already isn't either. Nothing writes here yet;
-- this migration only adds the column so the Dashboard preview can display
-- fictitious values while the real HealthKit integration is still being
-- decided on.
-- ============================================================================
alter table checkins add column active_energy_kcal numeric;
