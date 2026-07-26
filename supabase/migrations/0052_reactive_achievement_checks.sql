-- ============================================================================
-- Moves notify-achievements from once/day at 9am to every 15 minutes — but a
-- run that finds nothing new for a group is nearly free: this table tracks,
-- per group, "when did something last change" (dirty_at, bumped by a trigger
-- on every table that feeds badges/monthly challenges) vs "when did we last
-- actually evaluate this group" (last_checked_at, set by the Edge Function
-- itself). The Edge Function skips any group where dirty_at <= last_checked_at
-- — i.e. nothing happened since the last full evaluation — instead of paying
-- for the full history read + 42 badges + 17 monthly challenges every 15 min
-- for every group, active or not.
-- ============================================================================
create table achievement_check_state (
  group_id uuid primary key references groups (id) on delete cascade,
  dirty_at timestamptz not null default now(),
  last_checked_at timestamptz
);

alter table achievement_check_state enable row level security;
-- No policies at all — only the service-role key (the notify-achievements
-- Edge Function and this migration's own trigger) ever touches this table.

-- One row per existing group so the very first post-deploy run evaluates
-- everyone once (last_checked_at null => "never checked").
insert into achievement_check_state (group_id, dirty_at, last_checked_at)
  select id, now(), null from groups
  on conflict (group_id) do nothing;

create or replace function mark_group_achievements_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into achievement_check_state (group_id, dirty_at)
    values (coalesce(new.group_id, old.group_id), now())
    on conflict (group_id) do update set dirty_at = excluded.dirty_at;
  return coalesce(new, old);
end;
$$;

create trigger trg_dirty_checkins
  after insert or update on checkins
  for each row execute function mark_group_achievements_dirty();

create trigger trg_dirty_reactions
  after insert on checkin_reactions
  for each row execute function mark_group_achievements_dirty();

create trigger trg_dirty_excuse_dates
  after insert on excuse_dates
  for each row execute function mark_group_achievements_dirty();

create trigger trg_dirty_overrides
  after insert or update on attendance_overrides
  for each row execute function mark_group_achievements_dirty();

create trigger trg_dirty_wallet_tx
  after insert or update on wallet_transactions
  for each row execute function mark_group_achievements_dirty();

create trigger trg_dirty_rule_proposals
  after insert or update on rule_proposals
  for each row execute function mark_group_achievements_dirty();

create trigger trg_dirty_weekly_results
  after insert on weekly_evaluation_results
  for each row execute function mark_group_achievements_dirty();

create trigger trg_dirty_group_members
  after insert or update on group_members
  for each row execute function mark_group_achievements_dirty();

-- Re-schedule the existing cron job (same name => pg_cron updates it in
-- place) from daily at 9am Bogotá to every 15 minutes. No quiet hours: the
-- point of this change is fully reactive, any-time-of-day notifications.
select cron.schedule(
  'notify-achievements',
  '*/15 * * * *',
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
