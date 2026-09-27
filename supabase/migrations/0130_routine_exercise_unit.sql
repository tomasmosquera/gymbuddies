-- ============================================================================
-- Weight unit becomes a per-EXERCISE choice within a routine, not one unit
-- for the whole create_routine/update_routine call. Real gyms mix
-- kg-labeled and lbs-labeled machines in the same session (a leg press
-- marked in lbs, a cable stack marked in kg), so a member needs to type
-- each exercise's numbers exactly as their own machine shows them.
--
-- Each exercise item in p_exercises can now carry its own "unit" ('kg' or
-- 'lbs'); p_unit stays as the fallback for an item that doesn't specify one
-- (so old-shaped calls, and the exercise-level default, keep working) —
-- storage is unaffected either way: still canonical kg, via to_kg(), same
-- as before. Same signatures, so plain `create or replace` — no DROP needed.
-- ============================================================================
create or replace function create_routine(p_name text, p_exercises jsonb, p_group_id uuid default null, p_unit text default 'kg')
returns routines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_routine routines%rowtype;
  v_item jsonb;
  v_set jsonb;
  v_exercise_idx int := 0;
  v_re routine_exercises%rowtype;
  v_set_idx int;
  v_item_unit text;
begin
  if p_group_id is not null and not is_group_member(p_group_id) then
    raise exception 'no eres miembro de ese grupo';
  end if;
  perform validate_routine_exercises(p_exercises);

  insert into routines (owner_user_id, group_id, name)
    values (auth.uid(), p_group_id, btrim(p_name))
    returning * into v_routine;

  for v_item in select * from jsonb_array_elements(p_exercises) loop
    v_exercise_idx := v_exercise_idx + 1;
    v_item_unit := coalesce(v_item ->> 'unit', p_unit);
    insert into routine_exercises (routine_id, exercise_id, sort_order, rest_seconds, notes)
      values (
        v_routine.id, (v_item ->> 'exercise_id')::uuid, v_exercise_idx,
        (v_item ->> 'rest_seconds')::int, nullif(v_item ->> 'notes', '')
      )
      returning * into v_re;

    v_set_idx := 0;
    for v_set in select * from jsonb_array_elements(v_item -> 'sets') loop
      v_set_idx := v_set_idx + 1;
      insert into routine_exercise_sets (routine_exercise_id, set_number, target_reps, target_weight_kg, is_failure_target)
        values (
          v_re.id, v_set_idx, (v_set ->> 'target_reps')::int,
          to_kg((v_set ->> 'target_weight')::numeric, v_item_unit), coalesce((v_set ->> 'is_failure_target')::boolean, false)
        );
    end loop;
  end loop;

  return v_routine;
end;
$$;

create or replace function update_routine(p_routine_id uuid, p_name text, p_exercises jsonb, p_unit text default 'kg')
returns routines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_routine routines%rowtype;
  v_item jsonb;
  v_set jsonb;
  v_exercise_idx int := 0;
  v_re routine_exercises%rowtype;
  v_set_idx int;
  v_item_unit text;
begin
  select * into v_routine from routines where id = p_routine_id for update;
  if not found then
    raise exception 'rutina no encontrada';
  end if;
  if v_routine.owner_user_id <> auth.uid()
    and not (v_routine.group_id is not null and is_group_admin(v_routine.group_id)) then
    raise exception 'no puedes editar esta rutina';
  end if;
  perform validate_routine_exercises(p_exercises);

  update routines set name = btrim(p_name), updated_at = now() where id = p_routine_id returning * into v_routine;

  -- routine_exercise_sets cascades away with each routine_exercises row.
  delete from routine_exercises where routine_id = p_routine_id;
  for v_item in select * from jsonb_array_elements(p_exercises) loop
    v_exercise_idx := v_exercise_idx + 1;
    v_item_unit := coalesce(v_item ->> 'unit', p_unit);
    insert into routine_exercises (routine_id, exercise_id, sort_order, rest_seconds, notes)
      values (
        p_routine_id, (v_item ->> 'exercise_id')::uuid, v_exercise_idx,
        (v_item ->> 'rest_seconds')::int, nullif(v_item ->> 'notes', '')
      )
      returning * into v_re;

    v_set_idx := 0;
    for v_set in select * from jsonb_array_elements(v_item -> 'sets') loop
      v_set_idx := v_set_idx + 1;
      insert into routine_exercise_sets (routine_exercise_id, set_number, target_reps, target_weight_kg, is_failure_target)
        values (
          v_re.id, v_set_idx, (v_set ->> 'target_reps')::int,
          to_kg((v_set ->> 'target_weight')::numeric, v_item_unit), coalesce((v_set ->> 'is_failure_target')::boolean, false)
        );
    end loop;
  end loop;

  return v_routine;
end;
$$;
