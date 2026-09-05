-- ============================================================================
-- Lets each member choose the radius (in meters) of the checkout geofence —
-- how far they need to drift from their check-in spot before the "no
-- olvides tu foto de salida" reminder fires while the app is backgrounded,
-- instead of the hardcoded 100m (GEOFENCE_RADIUS_METERS in
-- checkoutReminders.ts). Global per user (not per group), same reasoning and
-- same self-service RPC shape as checkout_reminder_minutes/
-- set_checkout_reminder_minutes (0097).
--
-- Bounds: 20m floor because consumer GPS accuracy (worse indoors/urban
-- canyon) makes anything tighter prone to false triggers while still
-- physically at the gym; 500m ceiling covers a member at a large gym/complex
-- with a big parking lot without letting the setting become meaningless.
-- ============================================================================
alter table profiles add column checkout_geofence_radius_meters integer not null default 100
  check (checkout_geofence_radius_meters between 20 and 500);

create or replace function set_checkout_geofence_radius_meters(p_meters int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_meters < 20 or p_meters > 500 then
    raise exception 'checkout_geofence_radius_meters must be between 20 and 500';
  end if;
  update profiles set checkout_geofence_radius_meters = p_meters where id = auth.uid();
end;
$$;
