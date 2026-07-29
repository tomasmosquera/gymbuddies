-- ============================================================================
-- set_checkin_active_energy now refuses to lower an already-stored value.
-- The client side is moving from "only sync checkouts still missing a value"
-- to "re-check every checkout from the last 72h on every app open" (Health
-- can take a while to fully sync from a Watch, so an earlier attempt may
-- have saved a partial/undercounted sum) — this RPC is what makes that
-- re-check safe to run repeatedly: a later, more complete read only ever
-- moves the number up, never down.
-- ============================================================================
create or replace function set_checkin_active_energy(p_checkin_id uuid, p_active_energy_kcal numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update checkins
    set active_energy_kcal = p_active_energy_kcal
    where id = p_checkin_id
      and user_id = auth.uid()
      and (active_energy_kcal is null or p_active_energy_kcal > active_energy_kcal);
end;
$$;
