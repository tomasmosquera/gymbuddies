-- ============================================================================
-- Adds "achievements" as a 6th toggleable notification category (badges,
-- monthly challenges, level-ups — see the notify-achievements Edge Function
-- from migration 0049). send_push_notification already treats a MISSING key
-- as "on" (coalesce(..., true)), so existing profiles were already receiving
-- these notifications — this migration just backfills the explicit key so
-- the Permisos screen's toggle reflects reality instead of showing off.
-- ============================================================================
alter table profiles alter column notification_preferences set default '{
  "group_activity": true,
  "money": true,
  "votes": true,
  "reminders": true,
  "admin_actions": true,
  "achievements": true
}'::jsonb;

update profiles
  set notification_preferences = notification_preferences || '{"achievements": true}'::jsonb
  where not (notification_preferences ? 'achievements');
