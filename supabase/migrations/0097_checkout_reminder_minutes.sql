-- ============================================================================
-- Lets each member choose how long after check-in the "no olvides tu foto de
-- salida" reminder fires, instead of the hardcoded 20 minutes
-- (REMINDER_DELAY_SECONDS in checkoutReminders.ts). Global per user (not
-- per group) — it's a personal habit, not a per-group rule, unlike the
-- existing reminders on/off toggle which stays group-scoped
-- (group_members.notification_preferences). Same self-service RPC shape as
-- set_auto_checkin_other_groups/set_apple_health_enabled (0074/0055).
-- ============================================================================
alter table profiles add column checkout_reminder_minutes integer not null default 20
  check (checkout_reminder_minutes between 1 and 180);

create or replace function set_checkout_reminder_minutes(p_minutes int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_minutes < 1 or p_minutes > 180 then
    raise exception 'checkout_reminder_minutes must be between 1 and 180';
  end if;
  update profiles set checkout_reminder_minutes = p_minutes where id = auth.uid();
end;
$$;
