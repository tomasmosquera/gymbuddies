-- Hourly safety net for "other"-type excuse votes that never reached a
-- mathematically forced outcome (mirrors close-expired-rule-proposals).
select cron.schedule(
  'close-expired-excuse-votes',
  '0 * * * *',
  $$select close_expired_excuse_votes();$$
);

-- Hourly sweep to finalize members who gave notice and whose notice period
-- has elapsed.
select cron.schedule(
  'process-scheduled-leaves',
  '0 * * * *',
  $$select process_scheduled_leaves();$$
);
