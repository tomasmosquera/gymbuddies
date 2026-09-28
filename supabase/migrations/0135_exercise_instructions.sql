-- ============================================================================
-- Explicación tab needs step-by-step instructions, which we never stored —
-- exercise-gif-sync only fetched the GIF binary, not the exercise's JSON
-- metadata. secondary_muscles (added in 0131) was similarly always left at
-- its '{}' default; both are backfilled together since WorkoutX's
-- /exercises/exercise/:id returns both in one response.
-- ============================================================================
alter table exercises add column instructions text[] not null default '{}';
