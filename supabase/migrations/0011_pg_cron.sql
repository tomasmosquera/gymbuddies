-- Both scheduled jobs call plain SQL functions directly (no HTTP hop), so
-- the core money/attendance logic has no dependency on Edge Functions being
-- reachable. Push notifications are a separate, optional concern — see
-- supabase/functions/weekly-evaluation and the README for wiring it up.
create extension if not exists pg_cron with schema extensions;

-- 05:00 UTC Monday = 00:00 America/Bogota Monday. Colombia has no DST, so
-- this fixed UTC offset is correct year-round.
select cron.schedule(
  'weekly-evaluation',
  '0 5 * * 1',
  $$select run_weekly_evaluation();$$
);

-- Safety net for votes that never reached a mathematically forced outcome.
select cron.schedule(
  'close-expired-rule-proposals',
  '0 * * * *',
  $$select close_expired_proposals();$$
);
