-- ============================================================================
-- Two adjustments to 0127, from reviewing the first build against a Hevy
-- reference screenshot: exercise names in English (matching the reference
-- app's convention, "Movement (Equipment)" for variants — e.g. "Bench Press
-- (Dumbbell)"), and routines planned SET BY SET instead of one aggregate
-- "N sets x M reps" per exercise.
--
-- A routine_exercise no longer carries target_sets/target_reps/target_weight_kg
-- itself — it now owns a list of routine_exercise_sets, each an individually
-- editable planned set (its own target reps/weight, and whether it's meant
-- to be a to-failure set) — exactly the SET / weight / REPS / F table in the
-- reference screenshot. rest_seconds moves onto routine_exercises (one rest
-- timer per exercise, matching the reference's "Rest Timer: 2min 0s" row).
--
-- workout_session_exercises loses its own flat target_* columns the same
-- way, replaced by target_sets_snapshot — a frozen jsonb copy of the plan
-- at the moment the session started (same freeze-at-start idiom as
-- routine_name_snapshot; a plain jsonb blob here rather than another child
-- table because nothing ever edits a session's plan after it starts).
--
-- Nothing real exists yet in routines/routine_exercises/workout_sessions in
-- production (checked before writing this), so this is a clean replacement,
-- not a data-preserving migration.
-- ============================================================================

-- ---- exercise names, English (Hevy's own convention for equipment variants) ----
update exercises e set name = v.name from (values
  ('bench_press', 'Bench Press (Barbell)'),
  ('incline_bench_press', 'Incline Bench Press (Barbell)'),
  ('decline_bench_press', 'Decline Bench Press (Barbell)'),
  ('dumbbell_bench_press', 'Bench Press (Dumbbell)'),
  ('incline_dumbbell_press', 'Incline Bench Press (Dumbbell)'),
  ('dumbbell_flyes', 'Chest Fly (Dumbbell)'),
  ('pec_deck', 'Chest Fly (Machine)'),
  ('cable_crossover', 'Cable Crossover'),
  ('chest_press_machine', 'Chest Press (Machine)'),
  ('chest_dips', 'Chest Dip'),
  ('push_ups', 'Push-Up'),
  ('deadlift', 'Deadlift (Barbell)'),
  ('pull_ups', 'Pull Up'),
  ('chin_ups', 'Chin Up'),
  ('lat_pulldown', 'Lat Pulldown (Cable)'),
  ('barbell_row', 'Bent Over Row (Barbell)'),
  ('dumbbell_row', 'Bent Over Row (Dumbbell)'),
  ('t_bar_row', 'T Bar Row'),
  ('seated_cable_row', 'Seated Cable Row'),
  ('lat_pulldown_machine_row', 'Row (Machine)'),
  ('pullover', 'Pullover (Dumbbell)'),
  ('back_extension', 'Back Extension'),
  ('face_pull', 'Face Pull (Cable)'),
  ('overhead_press', 'Overhead Press (Barbell)'),
  ('dumbbell_shoulder_press', 'Shoulder Press (Dumbbell)'),
  ('arnold_press', 'Arnold Press (Dumbbell)'),
  ('lateral_raise', 'Lateral Raise (Dumbbell)'),
  ('cable_lateral_raise', 'Lateral Raise (Cable)'),
  ('front_raise', 'Front Raise (Dumbbell)'),
  ('rear_delt_flyes', 'Rear Delt Fly (Dumbbell)'),
  ('upright_row', 'Upright Row (Barbell)'),
  ('shoulder_press_machine', 'Shoulder Press (Machine)'),
  ('shrugs', 'Shrug (Dumbbell)'),
  ('barbell_curl', 'Bicep Curl (Barbell)'),
  ('dumbbell_curl', 'Bicep Curl (Dumbbell)'),
  ('hammer_curl', 'Hammer Curl (Dumbbell)'),
  ('preacher_curl', 'Preacher Curl (Barbell)'),
  ('cable_curl', 'Cable Curl'),
  ('concentration_curl', 'Concentration Curl (Dumbbell)'),
  ('ez_bar_curl', 'Bicep Curl (EZ Bar)'),
  ('skull_crusher', 'Skullcrusher (Barbell)'),
  ('triceps_pushdown', 'Triceps Pushdown (Cable)'),
  ('bench_dips', 'Bench Dip'),
  ('triceps_kickback', 'Triceps Kickback (Dumbbell)'),
  ('close_grip_bench_press', 'Close Grip Bench Press (Barbell)'),
  ('overhead_triceps_extension', 'Triceps Extension (Dumbbell)'),
  ('triceps_dips', 'Triceps Dip'),
  ('wrist_curl', 'Wrist Curl (Barbell)'),
  ('reverse_wrist_curl', 'Reverse Wrist Curl (Barbell)'),
  ('farmers_walk', 'Farmer''s Walk'),
  ('back_squat', 'Squat (Barbell)'),
  ('front_squat', 'Front Squat (Barbell)'),
  ('leg_press', 'Leg Press (Machine)'),
  ('leg_extension', 'Leg Extension (Machine)'),
  ('walking_lunges', 'Walking Lunge (Dumbbell)'),
  ('bulgarian_split_squat', 'Bulgarian Split Squat (Dumbbell)'),
  ('hack_squat', 'Hack Squat (Machine)'),
  ('step_ups', 'Step Up (Dumbbell)'),
  ('goblet_squat', 'Goblet Squat (Kettlebell)'),
  ('romanian_deadlift', 'Romanian Deadlift (Barbell)'),
  ('lying_leg_curl', 'Lying Leg Curl (Machine)'),
  ('seated_leg_curl', 'Seated Leg Curl (Machine)'),
  ('good_mornings', 'Good Morning (Barbell)'),
  ('stiff_leg_deadlift', 'Stiff Leg Deadlift (Dumbbell)'),
  ('hip_thrust', 'Hip Thrust (Barbell)'),
  ('glute_bridge', 'Glute Bridge'),
  ('cable_kickback', 'Glute Kickback (Cable)'),
  ('hip_abduction_machine', 'Hip Abduction (Machine)'),
  ('standing_calf_raise', 'Standing Calf Raise (Machine)'),
  ('seated_calf_raise', 'Seated Calf Raise (Machine)'),
  ('leg_press_calf_raise', 'Calf Press (Machine)'),
  ('sit_ups', 'Sit Up'),
  ('crunch', 'Crunch'),
  ('plank', 'Plank'),
  ('side_plank', 'Side Plank'),
  ('hanging_leg_raise', 'Hanging Leg Raise'),
  ('ab_wheel_rollout', 'Ab Wheel Rollout'),
  ('russian_twist', 'Russian Twist'),
  ('mountain_climbers', 'Mountain Climber'),
  ('cable_crunch', 'Cable Crunch'),
  ('treadmill_run', 'Treadmill'),
  ('stationary_bike', 'Stationary Bike'),
  ('rowing_machine', 'Rowing Machine'),
  ('elliptical', 'Elliptical Trainer'),
  ('jump_rope', 'Jump Rope'),
  ('stair_climber', 'Stair Climber'),
  ('clean', 'Clean (Barbell)'),
  ('snatch', 'Snatch (Barbell)'),
  ('clean_and_jerk', 'Clean and Jerk (Barbell)'),
  ('thruster', 'Thruster (Barbell)'),
  ('kettlebell_swing', 'Kettlebell Swing'),
  ('burpees', 'Burpee'),
  ('turkish_get_up', 'Turkish Get Up (Kettlebell)'),
  ('box_jump', 'Box Jump')
) as v(slug, name)
where e.slug = v.slug;

-- ---- routine_exercises: drop the aggregate target, add a rest timer ----
alter table routine_exercises drop column target_sets;
alter table routine_exercises drop column target_reps;
alter table routine_exercises drop column target_weight_kg;
alter table routine_exercises add column rest_seconds int check (rest_seconds is null or rest_seconds between 0 and 1800);

-- ---- routine_exercise_sets: the planned SET / weight / REPS / F table ----
create table routine_exercise_sets (
  id uuid primary key default gen_random_uuid(),
  routine_exercise_id uuid not null references routine_exercises (id) on delete cascade,
  set_number int not null check (set_number >= 1),
  target_reps int not null check (target_reps between 1 and 100),
  target_weight_kg numeric(6, 2) check (target_weight_kg is null or target_weight_kg >= 0),
  is_failure_target boolean not null default false,
  unique (routine_exercise_id, set_number)
);
create index routine_exercise_sets_routine_exercise_idx on routine_exercise_sets (routine_exercise_id);

alter table routine_exercise_sets enable row level security;
create policy routine_exercise_sets_select on routine_exercise_sets for select
  using (exists (
    select 1 from routine_exercises re join routines r on r.id = re.routine_id
      where re.id = routine_exercise_sets.routine_exercise_id
        and (r.owner_user_id = auth.uid() or (r.group_id is not null and is_group_member(r.group_id)))
  ));
revoke insert, update, delete on routine_exercise_sets from authenticated;

-- ---- workout_session_exercises: same aggregate -> snapshot swap ----
alter table workout_session_exercises drop column target_sets;
alter table workout_session_exercises drop column target_reps;
alter table workout_session_exercises drop column target_weight_kg;
alter table workout_session_exercises add column target_sets_snapshot jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- validate_routine_exercises: now expects
-- '[{"exercise_id": "...", "rest_seconds": 120, "notes": "...",
--    "sets": [{"target_reps": 8, "target_weight": 60, "is_failure_target": false}, ...]}, ...]'
-- target_weight is in whichever unit the caller's create_routine/update_routine
-- call declares (p_unit), same as before — only its home moved (per-set, not per-exercise).
-- ----------------------------------------------------------------------------
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
      if coalesce((v_set ->> 'target_reps')::int, 0) not between 1 and 100 then
        raise exception 'las repeticiones objetivo deben estar entre 1 y 100';
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
          to_kg((v_set ->> 'target_weight')::numeric, p_unit), coalesce((v_set ->> 'is_failure_target')::boolean, false)
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
          to_kg((v_set ->> 'target_weight')::numeric, p_unit), coalesce((v_set ->> 'is_failure_target')::boolean, false)
        );
    end loop;
  end loop;

  return v_routine;
end;
$$;

-- start_workout_session: builds each session_exercise's target_sets_snapshot
-- from the routine's routine_exercise_sets at THIS moment — frozen from here on.
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
  v_snapshot jsonb;
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

  insert into workout_sessions (user_id, routine_id, routine_name_snapshot, checkin_id)
    values (auth.uid(), p_routine_id, v_routine.name, p_checkin_id)
    returning * into v_session;

  if p_routine_id is not null then
    for v_re in select * from routine_exercises where routine_id = p_routine_id order by sort_order loop
      select coalesce(jsonb_agg(jsonb_build_object(
        'target_reps', s.target_reps, 'target_weight_kg', s.target_weight_kg, 'is_failure_target', s.is_failure_target
      ) order by s.set_number), '[]'::jsonb)
        into v_snapshot
        from routine_exercise_sets s where s.routine_exercise_id = v_re.id;

      insert into workout_session_exercises (session_id, exercise_id, sort_order, target_sets_snapshot)
        values (v_session.id, v_re.exercise_id, v_re.sort_order, v_snapshot);
    end loop;
  end if;

  return v_session;
end;
$$;
