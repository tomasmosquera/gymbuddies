-- ============================================================================
-- Two changes, shipped together since the second needs the first:
--
-- 1. A routine's planned reps become a RANGE (e.g. "8-10") instead of a
--    single number. Logging a set is unchanged — the member still types
--    exactly how many reps they actually did.
--
-- 2. Progressive Overload (a global per-user toggle, profiles.
--    progressive_overload_enabled — off by default): when a session's
--    ACTUAL logged sets for an exercise all reach their own position's
--    range CEILING, at one shared weight, that's a "hit"
--    (workout_session_exercises.progressive_overload_hit). The next time
--    that same routine's same exercise starts, start_workout_session finds
--    that hit and adds a fixed increment (2.5 kg / 5 lbs, by the member's
--    own weight_unit) on top of the carried-forward weight — flagged per
--    set as is_progressive_overload_suggestion so the UI can highlight it.
--    Toggling this off never loses the underlying history — it just stops
--    reading progressive_overload_hit at suggestion time.
-- ============================================================================

-- ---- 1. routine_exercise_sets: target_reps -> a range ----
alter table routine_exercise_sets rename column target_reps to target_reps_min;
alter table routine_exercise_sets add column target_reps_max int;
update routine_exercise_sets set target_reps_max = target_reps_min;
alter table routine_exercise_sets alter column target_reps_max set not null;
alter table routine_exercise_sets add constraint routine_exercise_sets_reps_max_check check (target_reps_max between 1 and 100);
alter table routine_exercise_sets add constraint routine_exercise_sets_reps_range_check check (target_reps_max >= target_reps_min);

-- ---- 2. progressive overload: the toggle + the per-session-exercise hit flag ----
alter table profiles add column progressive_overload_enabled boolean not null default false;
alter table workout_session_exercises add column progressive_overload_hit boolean not null default false;

create or replace function set_progressive_overload_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set progressive_overload_enabled = p_enabled where id = auth.uid();
end;
$$;

-- ---- validate_routine_exercises: target_reps -> target_reps_min/target_reps_max ----
create or replace function validate_routine_exercises(p_exercises jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_item jsonb;
  v_set jsonb;
  v_exercise_id uuid;
begin
  if jsonb_typeof(p_exercises) <> 'array' then
    raise exception 'la lista de ejercicios debe ser un arreglo';
  end if;
  if jsonb_array_length(p_exercises) = 0 then
    raise exception 'una rutina necesita al menos un ejercicio';
  end if;
  if jsonb_array_length(p_exercises) > 30 then
    raise exception 'una rutina no puede tener más de 30 ejercicios';
  end if;

  for v_item in select * from jsonb_array_elements(p_exercises) loop
    begin
      v_exercise_id := (v_item ->> 'exercise_id')::uuid;
    exception when others then
      raise exception 'exercise_id inválido';
    end;
    if not exists (select 1 from exercises where id = v_exercise_id) then
      raise exception 'ejercicio no encontrado: %', v_exercise_id;
    end if;
    if (v_item ->> 'rest_seconds') is not null and (v_item ->> 'rest_seconds')::int not between 0 and 1800 then
      raise exception 'el descanso debe estar entre 0 y 1800 segundos';
    end if;
    if jsonb_typeof(v_item -> 'sets') <> 'array' or jsonb_array_length(v_item -> 'sets') = 0 then
      raise exception 'cada ejercicio necesita al menos una serie';
    end if;
    if jsonb_array_length(v_item -> 'sets') > 15 then
      raise exception 'máximo 15 series por ejercicio';
    end if;
    for v_set in select * from jsonb_array_elements(v_item -> 'sets') loop
      if coalesce((v_set ->> 'target_reps_min')::int, 0) not between 1 and 100 then
        raise exception 'las repeticiones mínimas deben estar entre 1 y 100';
      end if;
      if coalesce((v_set ->> 'target_reps_max')::int, 0) not between 1 and 100 then
        raise exception 'las repeticiones máximas deben estar entre 1 y 100';
      end if;
      if (v_set ->> 'target_reps_max')::int < (v_set ->> 'target_reps_min')::int then
        raise exception 'las repeticiones máximas deben ser mayores o iguales a las mínimas';
      end if;
      if (v_set ->> 'target_weight') is not null and (v_set ->> 'target_weight')::numeric < 0 then
        raise exception 'el peso objetivo no puede ser negativo';
      end if;
    end loop;
  end loop;
end;
$$;

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
      insert into routine_exercise_sets (routine_exercise_id, set_number, target_reps_min, target_reps_max, target_weight_kg, is_failure_target)
        values (
          v_re.id, v_set_idx, (v_set ->> 'target_reps_min')::int, (v_set ->> 'target_reps_max')::int,
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
      insert into routine_exercise_sets (routine_exercise_id, set_number, target_reps_min, target_reps_max, target_weight_kg, is_failure_target)
        values (
          v_re.id, v_set_idx, (v_set ->> 'target_reps_min')::int, (v_set ->> 'target_reps_max')::int,
          to_kg((v_set ->> 'target_weight')::numeric, v_item_unit), coalesce((v_set ->> 'is_failure_target')::boolean, false)
        );
    end loop;
  end loop;

  return v_routine;
end;
$$;

-- ---- start_workout_session: reps range in the snapshot + progressive overload bump ----
create or replace function start_workout_session(p_routine_id uuid default null, p_checkin_id uuid default null)
returns workout_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing workout_sessions%rowtype;
  v_session workout_sessions%rowtype;
  v_routine routines%rowtype;
  v_re record;
  v_set record;
  v_snapshot jsonb;
  v_prev_session_id uuid;
  v_this_weight_kg numeric;
  v_this_reps int;
  v_last_raw_weight_kg numeric;
  v_last_reps int;
  v_last_suggested_weight_kg numeric;
  v_suggested_weight_kg numeric;
  v_is_po_suggestion boolean;
  v_should_bump boolean;
  v_weight_unit text;
  v_po_enabled boolean;
  v_increment_kg numeric;
begin
  select * into v_existing from workout_sessions where user_id = auth.uid() and status = 'in_progress';
  if found then
    return v_existing;
  end if;

  if p_checkin_id is not null and not exists (
    select 1 from checkins where id = p_checkin_id and user_id = auth.uid()
  ) then
    raise exception 'check-in inválido';
  end if;

  if p_routine_id is not null then
    select * into v_routine from routines where id = p_routine_id
      and (owner_user_id = auth.uid() or (group_id is not null and is_group_member(group_id)));
    if not found then
      raise exception 'rutina no encontrada';
    end if;
  end if;

  select coalesce(weight_unit, 'kg'), progressive_overload_enabled into v_weight_unit, v_po_enabled
    from profiles where id = auth.uid();
  v_increment_kg := to_kg(case when v_weight_unit = 'lbs' then 5 else 2.5 end, v_weight_unit);

  insert into workout_sessions (user_id, routine_id, routine_name_snapshot, checkin_id)
    values (auth.uid(), p_routine_id, v_routine.name, p_checkin_id)
    returning * into v_session;

  if p_routine_id is not null then
    for v_re in select * from routine_exercises where routine_id = p_routine_id order by sort_order loop
      select s.id into v_prev_session_id
        from workout_sessions s
        join workout_session_exercises wse on wse.session_id = s.id
        join workout_sets ws on ws.session_exercise_id = wse.id
        where s.routine_id = p_routine_id and s.user_id = auth.uid() and s.status = 'completed'
          and wse.exercise_id = v_re.exercise_id
          and ws.weight_kg is not null
        order by s.started_at desc
        limit 1;

      -- Only the MOST RECENT qualifying session's own hit matters — this is
      -- "did you crush it last time", not a streak requirement.
      v_should_bump := false;
      if v_prev_session_id is not null and v_po_enabled then
        select coalesce(wse.progressive_overload_hit, false) into v_should_bump
          from workout_session_exercises wse
          where wse.session_id = v_prev_session_id and wse.exercise_id = v_re.exercise_id;
      end if;

      v_snapshot := '[]'::jsonb;
      v_last_raw_weight_kg := null;
      v_last_reps := null;
      v_last_suggested_weight_kg := null;
      for v_set in select * from routine_exercise_sets where routine_exercise_id = v_re.id order by set_number loop
        v_this_weight_kg := null;
        v_this_reps := null;
        if v_prev_session_id is not null then
          select ws.weight_kg, ws.reps into v_this_weight_kg, v_this_reps
            from workout_session_exercises wse
            join workout_sets ws on ws.session_exercise_id = wse.id
            where wse.session_id = v_prev_session_id and wse.exercise_id = v_re.exercise_id and ws.set_number = v_set.set_number;
          if v_this_weight_kg is not null then
            -- previous_weight_kg/previous_reps ALWAYS stay the true raw
            -- history, even when the bump applies — only target_weight_kg
            -- (the actual suggestion) gets the increment added.
            v_last_raw_weight_kg := v_this_weight_kg;
            v_last_reps := v_this_reps;
            v_last_suggested_weight_kg := v_this_weight_kg + case when v_should_bump then v_increment_kg else 0 end;
          end if;
        end if;
        v_suggested_weight_kg := coalesce(v_last_suggested_weight_kg, v_set.target_weight_kg);
        v_is_po_suggestion := v_should_bump and v_last_suggested_weight_kg is not null;

        v_snapshot := v_snapshot || jsonb_build_object(
          'target_reps_min', v_set.target_reps_min, 'target_reps_max', v_set.target_reps_max,
          'target_weight_kg', v_suggested_weight_kg, 'is_failure_target', v_set.is_failure_target,
          'previous_weight_kg', v_last_raw_weight_kg, 'previous_reps', v_last_reps,
          'is_progressive_overload_suggestion', v_is_po_suggestion
        );
      end loop;

      insert into workout_session_exercises (session_id, exercise_id, sort_order, target_sets_snapshot, rest_seconds)
        values (v_session.id, v_re.exercise_id, v_re.sort_order, v_snapshot, v_re.rest_seconds);
    end loop;
  end if;

  return v_session;
end;
$$;

-- ---- finish_workout_session: also settles progressive_overload_hit per exercise ----
create or replace function finish_workout_session(p_session_id uuid, p_notes text default null)
returns workout_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session workout_sessions%rowtype;
  v_wse record;
  v_target record;
  v_logged_reps int;
  v_logged_weight_kg numeric;
  v_has_relevant_target boolean;
  v_hit boolean;
  v_weight_kg numeric;
begin
  select * into v_session from workout_sessions where id = p_session_id and user_id = auth.uid();
  if not found or v_session.status <> 'in_progress' then
    raise exception 'este entreno no está en curso';
  end if;

  -- Progressive overload check, per exercise: every non-failure planned set
  -- (in target_sets_snapshot order) is matched, in order, against a REAL
  -- (non-warmup) logged set — same "Nth planned slot" idea the live screen
  -- itself already uses. A hit needs every one of them to reach ITS OWN
  -- position's target_reps_max, all at one single shared weight. An
  -- exercise with no non-failure planned sets at all (every set is a
  -- to-failure target, or it was added freeform with no plan) never hits —
  -- there's no ceiling to compare against. See start_workout_session for
  -- what a hit unlocks next time.
  for v_wse in select * from workout_session_exercises where session_id = p_session_id loop
    v_hit := true;
    v_weight_kg := null;
    v_has_relevant_target := false;

    for v_target in
      select (elem ->> 'target_reps_max')::int as target_reps_max, row_number() over () as rn
        from jsonb_array_elements(v_wse.target_sets_snapshot) as elem
        where coalesce((elem ->> 'is_failure_target')::boolean, false) = false
    loop
      v_has_relevant_target := true;
      if v_target.target_reps_max is null then
        v_hit := false; -- legacy snapshot from before this feature shipped — nothing to compare
        continue;
      end if;

      v_logged_reps := null;
      v_logged_weight_kg := null;
      select l.reps, l.weight_kg into v_logged_reps, v_logged_weight_kg
        from (
          select reps, weight_kg, row_number() over (order by set_number) as rn
            from workout_sets where session_exercise_id = v_wse.id and not is_warmup
        ) l
        where l.rn = v_target.rn;

      if v_logged_reps is null or v_logged_reps < v_target.target_reps_max or v_logged_weight_kg is null then
        v_hit := false;
      elsif v_weight_kg is null then
        v_weight_kg := v_logged_weight_kg;
      elsif v_logged_weight_kg <> v_weight_kg then
        v_hit := false;
      end if;
    end loop;

    update workout_session_exercises
      set progressive_overload_hit = (v_hit and v_has_relevant_target)
      where id = v_wse.id;
  end loop;

  update workout_sessions set status = 'completed', finished_at = now(), notes = nullif(p_notes, '')
    where id = p_session_id
    returning * into v_session;
  return v_session;
end;
$$;
