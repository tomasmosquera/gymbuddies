-- ============================================================================
-- set_checkin_date's clock-drift guard re-checks captured_at on EVERY
-- update to a checkins row, not just when captured_at itself is being set —
-- meaning set_checkin_active_energy below (called potentially hours after
-- the original check-in, once Health has synced) would always fail once the
-- original captured_at is more than 4h in the past. Only re-validate when
-- captured_at is actually the thing changing (or being inserted for the
-- first time); other columns (workout_minutes, active_energy_kcal, checkout
-- fields) can update freely afterward.
-- ============================================================================
create or replace function set_checkin_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.captured_at is distinct from old.captured_at then
    if abs(extract(epoch from (now() - new.captured_at))) > 14400 then
      raise exception 'captured_at is too far from server time (clock drift guard)';
    end if;
  end if;
  new.checkin_date := (new.captured_at at time zone 'America/Bogota')::date;
  if tg_op = 'UPDATE' and new.checkin_date <> old.checkin_date then
    raise exception 'a check-in cannot be moved to a different day; take a new one instead';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- Apple Health (HealthKit) integration — read-only, display-only active
-- calories burned during a workout (checkins.active_energy_kcal, added in
-- 0054). Never feeds penalties, ranking, or badges.
--
-- apple_health_enabled is an APP-LEVEL toggle, not the OS permission itself:
-- iOS never lets an app revoke a HealthKit grant it already has (only the
-- user can, from Ajustes > Salud > Acceso a Datos y Dispositivos) — turning
-- this off just means the app stops asking Health for anything and stops
-- writing active_energy_kcal, even if the OS-level permission is still
-- technically granted.
--
-- apple_health_prompted_at tracks whether this user has already seen the
-- one-time "¿quieres conectar Apple Health?" nudge shown once on next open,
-- so it never nags a second time regardless of their answer.
-- ============================================================================
alter table profiles add column apple_health_enabled boolean not null default false;
alter table profiles add column apple_health_prompted_at timestamptz;

create or replace function set_apple_health_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
    set apple_health_enabled = p_enabled,
        apple_health_prompted_at = coalesce(apple_health_prompted_at, now())
    where id = auth.uid();
end;
$$;

-- Called when the user dismisses the one-time prompt without toggling
-- anything (e.g. taps "Ahora no") — still marks it as seen.
create or replace function dismiss_apple_health_prompt()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set apple_health_prompted_at = now() where id = auth.uid();
end;
$$;

-- Self-service, mirrors delete_own_checkin's "only your own row" pattern.
-- A separate RPC (not a param on submit_workout_checkout) so the checkout
-- submission itself never waits on a HealthKit query — the calorie figure
-- is fetched and attached after checkout already succeeded.
create or replace function set_checkin_active_energy(p_checkin_id uuid, p_active_energy_kcal numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update checkins
    set active_energy_kcal = p_active_energy_kcal
    where id = p_checkin_id and user_id = auth.uid();
end;
$$;
