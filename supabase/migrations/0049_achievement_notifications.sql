-- ============================================================================
-- Tracking tables for badge/monthly-challenge/level-up push notifications.
-- Badges themselves are still computed 100% live (see src/lib/domain/badges.ts
-- and monthlyChallenges.ts) — there is still no "badges" table. These two
-- tables exist ONLY to remember what's already been notified about, so the
-- daily notify-achievements Edge Function can diff "earned now" against
-- "already notified" and only ever push once per achievement.
--
-- `period` is 'lifetime' for the 42 lifetime badges (badges.ts), or a
-- 'YYYY-MM' string for a specific month's occurrence of one of the 17
-- monthly challenges (monthlyChallenges.ts) — a monthly challenge can
-- legitimately notify multiple times, once per month it's achieved again.
-- Written only by the Edge Function via the service-role key; clients only
-- ever read (and only their own group's rows, same as everything else).
-- ============================================================================
create table member_achievement_notifications (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  badge_id text not null,
  period text not null default 'lifetime',
  notified_at timestamptz not null default now(),
  primary key (group_id, user_id, badge_id, period)
);

create table member_level_notifications (
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  last_notified_level int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table member_achievement_notifications enable row level security;
alter table member_level_notifications enable row level security;

create policy member_achievement_notifications_select on member_achievement_notifications
  for select
  using (is_group_member(group_id));

create policy member_level_notifications_select on member_level_notifications
  for select
  using (is_group_member(group_id));

-- No insert/update/delete policies at all — only the service-role key (used
-- exclusively by the notify-achievements Edge Function) can write here,
-- exactly like every other system-written table in this schema.
revoke insert, update, delete on member_achievement_notifications from authenticated;
revoke insert, update, delete on member_level_notifications from authenticated;

-- ============================================================================
-- Once a day at 14:00 UTC (9:00 AM America/Bogota, fixed offset — no DST)
-- invokes the notify-achievements Edge Function, which evaluates every
-- group's badges/monthly challenges/level (see supabase/functions/notify-
-- achievements/index.ts) and pushes exactly once per newly-detected
-- achievement. Deployed with --no-verify-jwt (this is an internal,
-- cron-only job, never called by the app itself), so the bearer token below
-- is only for routing, not an auth gate.
-- ============================================================================
select cron.schedule(
  'notify-achievements',
  '0 14 * * *',
  $$
  select net.http_post(
    url := 'https://iaiyntjmchndfmnvhbfm.supabase.co/functions/v1/notify-achievements',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_HwrT0rm1ZWqSkZaJMbxhCw_uzYjlC6p',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
