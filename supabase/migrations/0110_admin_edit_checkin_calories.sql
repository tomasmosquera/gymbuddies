-- ============================================================================
-- Lets the group admin correct a check-in's recorded calories, the same way
-- admin_set_checkin_workout_minutes (0075) already lets them correct its
-- duration. set_checkin_active_energy (0055/0056) can't be reused here —
-- it's the member's own Apple Health sync path, scoped to auth.uid() and
-- deliberately refuses to ever lower an already-stored value, neither of
-- which fits an admin fixing someone else's wrong/inflated number.
-- Nullable — an empty admin input clears it back to "sin datos" rather than
-- forcing it to 0.
-- ============================================================================
create or replace function admin_set_checkin_active_energy(p_checkin_id uuid, p_active_energy_kcal numeric default null)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
begin
  if p_active_energy_kcal is not null and p_active_energy_kcal < 0 then
    raise exception 'active energy must be 0 or greater';
  end if;

  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_admin(v_checkin.group_id) then
    raise exception 'only the group admin can edit a check-in''s calories';
  end if;

  update checkins set active_energy_kcal = p_active_energy_kcal where id = p_checkin_id returning * into v_checkin;

  return v_checkin;
end;
$$;
