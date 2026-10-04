-- ============================================================================
-- The on-device "local" reminders (checkout photo pending, arrived-at-the-gym
-- check-in nudge, workout-duration milestones) were gated by
-- getRemindersEnabledCache() — ALREADY a single global AsyncStorage flag
-- (only one gym a member is physically at, at a time) — but that cache was
-- populated from group_members.notification_preferences->>'reminders', a
-- PER-GROUP column. Flipping the toggle while viewing one group silently
-- changed the effective value for every other group too, since they all
-- shared the one global runtime cache regardless of which group's row was
-- actually written.
--
-- profiles.checkout_reminder_minutes' own doc comment already called this out:
-- "Global per user, unlike the reminders on/off toggle which is per group."
-- This migration fixes the mismatch the other way around: the toggle moves
-- to match the already-global behavior, not the other way.
--
-- group_members.notification_preferences->>'reminders' is UNCHANGED and keeps
-- its own, genuinely per-group meaning: it still gates the two SERVER-pushed
-- notifications that really do vary per group (send_checkin_reminders' daily
-- "no olvides tu check-in" nudge, and buddy_nudges) — those are untouched.
-- ============================================================================

alter table profiles add column local_reminders_enabled boolean not null default true;

create or replace function set_local_reminders_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set local_reminders_enabled = p_enabled where id = auth.uid();
end;
$$;
