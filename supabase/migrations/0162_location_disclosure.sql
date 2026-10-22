-- ============================================================================
-- Google Play's Prominent Disclosure & Consent requirement: a sensitive
-- permission like location must be explained in-app — what's collected, why
-- — BEFORE the OS permission dialog ever fires, with an explicit in-app
-- acknowledgment. The OS dialog's own description text (NSLocationWhenInUse
-- UsageDescription / the Android rationale) doesn't satisfy this on its own;
-- it has to be a separate, prior disclosure shown during normal app use.
-- Rejected for exactly this (2026-10-22): "The in-app Prominent Disclosure
-- does not disclose the usage of accessed or collected Location data."
--
-- Mirrors apple_health_prompted_at's own shape/precedent exactly (same
-- "shown once, stamped regardless of which button" pattern) — see
-- useLocationDisclosurePrompt.ts for the actual one-time Alert.
-- ============================================================================
alter table profiles add column location_disclosure_acknowledged_at timestamptz;

create or replace function acknowledge_location_disclosure()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
    set location_disclosure_acknowledged_at = coalesce(location_disclosure_acknowledged_at, now())
    where id = auth.uid();
end;
$$;
