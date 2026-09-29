-- ============================================================================
-- update_set/delete_set used to require the parent workout_session to still
-- be 'in_progress' ("a finished workout's numbers don't get rewritten
-- later, same rule weekly_evaluation_results already follows" — 0127). That
-- reasoning doesn't actually hold here: weekly_evaluation_results freezes a
-- number that determines a real charge already applied to someone's wallet,
-- so rewriting it after the fact would be unfair. workout_sets is personal
-- exercise tracking (reps/weight for King of the Hill, exercise history,
-- Muscle Split) — nothing financial reads it, so there's no fairness reason
-- to lock it at finish_workout_session. This was blocking a real, common
-- need: fixing a mistyped weight/reps after already tapping "Terminar".
--
-- Same signatures — plain `create or replace`, no DROP needed. Only the
-- session-status check is removed; everything else (ownership via
-- auth.uid(), reps/weight validation) is unchanged.
-- ============================================================================

create or replace function update_set(p_set_id uuid, p_reps int, p_weight numeric default null, p_unit text default 'kg', p_is_warmup boolean default false)
returns workout_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owns boolean;
  v_weight_kg numeric;
  v_row workout_sets%rowtype;
begin
  select true into v_owns
    from workout_sets ws
      join workout_session_exercises se on se.id = ws.session_exercise_id
      join workout_sessions s on s.id = se.session_id
    where ws.id = p_set_id and s.user_id = auth.uid();
  if v_owns is null then
    raise exception 'set no encontrado';
  end if;
  if p_reps is null or p_reps <= 0 then
    raise exception 'las repeticiones deben ser mayores a 0';
  end if;
  if p_weight is not null and p_weight < 0 then
    raise exception 'el peso no puede ser negativo';
  end if;
  v_weight_kg := to_kg(p_weight, p_unit);

  update workout_sets set reps = p_reps, weight_kg = v_weight_kg, is_warmup = coalesce(p_is_warmup, false)
    where id = p_set_id
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function delete_set(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owns boolean;
begin
  select true into v_owns
    from workout_sets ws
      join workout_session_exercises se on se.id = ws.session_exercise_id
      join workout_sessions s on s.id = se.session_id
    where ws.id = p_set_id and s.user_id = auth.uid();
  if v_owns is null then
    raise exception 'set no encontrado';
  end if;

  delete from workout_sets where id = p_set_id;
end;
$$;
