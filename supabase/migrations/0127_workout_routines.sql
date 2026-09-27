-- ============================================================================
-- Workout routines, exercise catalog, and live workout logging (Fase 0).
--
-- Product shape (see conversation): a member creates routines (personal, or
-- shared with one of their groups), each a list of exercises with a target
-- sets/reps/weight. Starting a workout — from a routine or completely
-- freeform — opens a live session: exercises get added one at a time (from
-- the routine, or ad hoc), and sets get logged one at a time as they're
-- actually done, each row a fact ("I did 60kg x8"), never a plan being
-- edited after the fact. Progressive overload ("what did I do last time")
-- and the group ranking are both derived by reading these facts directly —
-- no separate "PR" table to keep in sync, same anti-denormalization
-- discipline as koth_records (0083) and league_cycle_standings (0126).
--
-- Visibility deliberately does NOT depend on being in the same group as the
-- session's checkin — sharing ANY active group with someone is enough to
-- see their workout history, same as badges/stats already work. That's
-- shares_active_group_with() below: is_group_member() only answers "is the caller
-- a member of THIS group", not "do these two people have a group in
-- common", so it needs its own helper.
--
-- What this migration does NOT include yet (deliberately deferred):
--   - Any screen. This is backend-only; the routine list/create/edit UI is
--     a separate, client-only piece of this same phase, and the live
--     logging screen is a later phase.
--   - Hooking start_workout_session up to the check-in flow — for now
--     start_workout_session/log_set/etc. are plain RPCs nothing calls yet.
--   - Custom (user-added) exercises, XP/badges, and a Live Activity for the
--     rest timer — all explicitly out of scope for this version.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- exercises: the fixed, global catalog — same shape/spirit as koth_exercises
-- (0083), but sized for a real "pick from ~100+" search UI instead of a
-- short fixed list, so it has no hand-maintained sort_order: the client
-- lists it alphabetically (or grouped by muscle_group) and searches by name.
-- Names follow how people actually say them in a Spanish-speaking gym —
-- Spanish for the classic barbell lifts, the common English/Spanglish term
-- for machine and cable movements (Cable Curl, Lat Pulldown, Leg Press),
-- matching the user's own examples ("cable curl", "pull downs en máquina").
-- ----------------------------------------------------------------------------
create table exercises (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  muscle_group text not null check (muscle_group in (
    'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
    'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio', 'full_body'
  )),
  equipment text not null check (equipment in (
    'barbell', 'dumbbell', 'machine', 'cable', 'smith_machine', 'bodyweight', 'kettlebell', 'band', 'other'
  )),
  created_at timestamptz not null default now()
);
create index exercises_muscle_group_idx on exercises (muscle_group);

insert into exercises (slug, name, muscle_group, equipment) values
  -- Chest
  ('bench_press', 'Press de Banca', 'chest', 'barbell'),
  ('incline_bench_press', 'Press Inclinado con Barra', 'chest', 'barbell'),
  ('decline_bench_press', 'Press Declinado con Barra', 'chest', 'barbell'),
  ('dumbbell_bench_press', 'Press de Banca con Mancuernas', 'chest', 'dumbbell'),
  ('incline_dumbbell_press', 'Press Inclinado con Mancuernas', 'chest', 'dumbbell'),
  ('dumbbell_flyes', 'Aperturas con Mancuernas', 'chest', 'dumbbell'),
  ('pec_deck', 'Aperturas en Máquina (Pec Deck)', 'chest', 'machine'),
  ('cable_crossover', 'Cruces en Polea', 'chest', 'cable'),
  ('chest_press_machine', 'Press en Máquina', 'chest', 'machine'),
  ('chest_dips', 'Fondos en Paralelas (Pecho)', 'chest', 'bodyweight'),
  ('push_ups', 'Flexiones de Pecho (Push-ups)', 'chest', 'bodyweight'),
  -- Back
  ('deadlift', 'Peso Muerto', 'back', 'barbell'),
  ('pull_ups', 'Dominadas', 'back', 'bodyweight'),
  ('chin_ups', 'Dominadas Supinas (Chin-ups)', 'back', 'bodyweight'),
  ('lat_pulldown', 'Jalón al Pecho (Lat Pulldown)', 'back', 'cable'),
  ('barbell_row', 'Remo con Barra', 'back', 'barbell'),
  ('dumbbell_row', 'Remo con Mancuerna', 'back', 'dumbbell'),
  ('t_bar_row', 'Remo en T (T-Bar Row)', 'back', 'machine'),
  ('seated_cable_row', 'Remo en Polea Baja', 'back', 'cable'),
  ('lat_pulldown_machine_row', 'Remo en Máquina', 'back', 'machine'),
  ('pullover', 'Pull-over', 'back', 'dumbbell'),
  ('back_extension', 'Hiperextensiones', 'back', 'bodyweight'),
  ('face_pull', 'Face Pull', 'back', 'cable'),
  -- Shoulders
  ('overhead_press', 'Press Militar con Barra', 'shoulders', 'barbell'),
  ('dumbbell_shoulder_press', 'Press Militar con Mancuernas', 'shoulders', 'dumbbell'),
  ('arnold_press', 'Press Arnold', 'shoulders', 'dumbbell'),
  ('lateral_raise', 'Elevaciones Laterales', 'shoulders', 'dumbbell'),
  ('cable_lateral_raise', 'Elevaciones Laterales en Polea', 'shoulders', 'cable'),
  ('front_raise', 'Elevaciones Frontales', 'shoulders', 'dumbbell'),
  ('rear_delt_flyes', 'Pájaros (Elevación Posterior)', 'shoulders', 'dumbbell'),
  ('upright_row', 'Remo al Mentón', 'shoulders', 'barbell'),
  ('shoulder_press_machine', 'Press de Hombro en Máquina', 'shoulders', 'machine'),
  ('shrugs', 'Encogimientos de Hombros (Shrugs)', 'shoulders', 'dumbbell'),
  -- Biceps
  ('barbell_curl', 'Curl con Barra', 'biceps', 'barbell'),
  ('dumbbell_curl', 'Curl con Mancuernas', 'biceps', 'dumbbell'),
  ('hammer_curl', 'Curl Martillo', 'biceps', 'dumbbell'),
  ('preacher_curl', 'Curl en Banco Scott (Preacher Curl)', 'biceps', 'barbell'),
  ('cable_curl', 'Cable Curl', 'biceps', 'cable'),
  ('concentration_curl', 'Curl Concentrado', 'biceps', 'dumbbell'),
  ('ez_bar_curl', 'Curl con Barra Z', 'biceps', 'barbell'),
  -- Triceps
  ('skull_crusher', 'Press Francés (Skull Crusher)', 'triceps', 'barbell'),
  ('triceps_pushdown', 'Extensión de Tríceps en Polea (Pushdown)', 'triceps', 'cable'),
  ('bench_dips', 'Fondos en Banco (Bench Dips)', 'triceps', 'bodyweight'),
  ('triceps_kickback', 'Patada de Tríceps (Kickback)', 'triceps', 'dumbbell'),
  ('close_grip_bench_press', 'Press Cerrado (Close-Grip Bench Press)', 'triceps', 'barbell'),
  ('overhead_triceps_extension', 'Extensión de Tríceps sobre la Cabeza', 'triceps', 'dumbbell'),
  ('triceps_dips', 'Fondos en Paralelas (Tríceps)', 'triceps', 'bodyweight'),
  -- Forearms
  ('wrist_curl', 'Curl de Muñeca', 'forearms', 'barbell'),
  ('reverse_wrist_curl', 'Curl de Muñeca Invertido', 'forearms', 'barbell'),
  ('farmers_walk', 'Farmer''s Walk', 'forearms', 'dumbbell'),
  -- Quads
  ('back_squat', 'Sentadilla', 'quads', 'barbell'),
  ('front_squat', 'Sentadilla Frontal', 'quads', 'barbell'),
  ('leg_press', 'Prensa de Piernas (Leg Press)', 'quads', 'machine'),
  ('leg_extension', 'Extensión de Cuádriceps (Leg Extension)', 'quads', 'machine'),
  ('walking_lunges', 'Zancadas (Lunges)', 'quads', 'dumbbell'),
  ('bulgarian_split_squat', 'Sentadilla Búlgara', 'quads', 'dumbbell'),
  ('hack_squat', 'Sentadilla Hack', 'quads', 'machine'),
  ('step_ups', 'Step-ups', 'quads', 'dumbbell'),
  ('goblet_squat', 'Sentadilla Goblet', 'quads', 'kettlebell'),
  -- Hamstrings
  ('romanian_deadlift', 'Peso Muerto Rumano', 'hamstrings', 'barbell'),
  ('lying_leg_curl', 'Curl Femoral Acostado', 'hamstrings', 'machine'),
  ('seated_leg_curl', 'Curl Femoral Sentado', 'hamstrings', 'machine'),
  ('good_mornings', 'Buenos Días (Good Mornings)', 'hamstrings', 'barbell'),
  ('stiff_leg_deadlift', 'Peso Muerto con Piernas Rígidas', 'hamstrings', 'dumbbell'),
  -- Glutes
  ('hip_thrust', 'Hip Thrust', 'glutes', 'barbell'),
  ('glute_bridge', 'Puente de Glúteos', 'glutes', 'bodyweight'),
  ('cable_kickback', 'Patada de Glúteo en Polea', 'glutes', 'cable'),
  ('hip_abduction_machine', 'Abducción de Cadera en Máquina', 'glutes', 'machine'),
  -- Calves
  ('standing_calf_raise', 'Elevación de Talones de Pie', 'calves', 'machine'),
  ('seated_calf_raise', 'Elevación de Talones Sentado', 'calves', 'machine'),
  ('leg_press_calf_raise', 'Elevación de Talones en Prensa', 'calves', 'machine'),
  -- Core
  ('sit_ups', 'Abdominales (Sit-ups)', 'core', 'bodyweight'),
  ('crunch', 'Crunch', 'core', 'bodyweight'),
  ('plank', 'Plancha (Plank)', 'core', 'bodyweight'),
  ('side_plank', 'Plancha Lateral (Side Plank)', 'core', 'bodyweight'),
  ('hanging_leg_raise', 'Elevación de Piernas Colgado', 'core', 'bodyweight'),
  ('ab_wheel_rollout', 'Rueda Abdominal (Ab Wheel)', 'core', 'other'),
  ('russian_twist', 'Russian Twist', 'core', 'bodyweight'),
  ('mountain_climbers', 'Mountain Climbers', 'core', 'bodyweight'),
  ('cable_crunch', 'Crunch en Polea', 'core', 'cable'),
  -- Cardio
  ('treadmill_run', 'Correr en Cinta', 'cardio', 'other'),
  ('stationary_bike', 'Bicicleta Estática', 'cardio', 'other'),
  ('rowing_machine', 'Remo (Rowing Machine)', 'cardio', 'machine'),
  ('elliptical', 'Elíptica', 'cardio', 'other'),
  ('jump_rope', 'Cuerda (Jump Rope)', 'cardio', 'other'),
  ('stair_climber', 'Escaladora (StairMaster)', 'cardio', 'machine'),
  -- Full body / olympic / conditioning
  ('clean', 'Clean', 'full_body', 'barbell'),
  ('snatch', 'Snatch', 'full_body', 'barbell'),
  ('clean_and_jerk', 'Clean and Jerk', 'full_body', 'barbell'),
  ('thruster', 'Thruster', 'full_body', 'barbell'),
  ('kettlebell_swing', 'Kettlebell Swing', 'full_body', 'kettlebell'),
  ('burpees', 'Burpees', 'full_body', 'bodyweight'),
  ('turkish_get_up', 'Turkish Get-up', 'full_body', 'kettlebell'),
  ('box_jump', 'Box Jump', 'full_body', 'other');

alter table exercises enable row level security;
create policy exercises_select on exercises for select using (true);
revoke insert, update, delete on exercises from authenticated;

-- ----------------------------------------------------------------------------
-- Weight unit preference: everything is STORED in kg (weight_kg /
-- target_weight_kg columns) — that's also what a group comparison always
-- shows, regardless of who's looking. This is only what a member sees and
-- types in THEIR OWN screens (routine editor, live logging, their own
-- history) — same idea as koth_claims.submitted_unit, but as a standing
-- preference rather than a per-claim choice, since nothing here is an
-- audited claim someone might dispute. Conversion happens SERVER-SIDE in
-- every RPC that takes a weight, from whatever p_unit is passed, never
-- trusting a client-computed kg number — same discipline
-- submit_koth_claim (0083) already applies for the exact same reason.
-- ----------------------------------------------------------------------------
alter table profiles add column weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lbs'));

create or replace function set_weight_unit(p_unit text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_unit not in ('kg', 'lbs') then
    raise exception 'unidad inválida';
  end if;
  update profiles set weight_unit = p_unit where id = auth.uid();
end;
$$;

-- lbs -> kg, shared by every RPC below that takes a weight + unit.
create or replace function to_kg(p_value numeric, p_unit text)
returns numeric
language plpgsql
immutable
as $$
begin
  if p_value is null then
    return null;
  end if;
  if p_unit not in ('kg', 'lbs') then
    raise exception 'unidad inválida';
  end if;
  return case when p_unit = 'lbs' then round(p_value * 0.45359237, 2) else round(p_value, 2) end;
end;
$$;

-- ----------------------------------------------------------------------------
-- shares_active_group_with: "do the caller and p_other_user_id currently have an
-- eligible membership in any group in common" — is_group_member (0007/0109)
-- only ever answers "is the caller a member of THIS group", so it can't be
-- reused for "can I see this OTHER person's stuff". Same eligible-status
-- list as is_group_member.
-- ----------------------------------------------------------------------------
create or replace function shares_active_group_with(p_other_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members gm1
      join group_members gm2 on gm2.group_id = gm1.group_id
      where gm1.user_id = auth.uid()
        and gm1.status in ('pending_deposit', 'active', 'needs_recharge', 'admin_only')
        and gm2.user_id = p_other_user_id
        and gm2.status in ('pending_deposit', 'active', 'needs_recharge', 'admin_only')
  );
$$;

-- ----------------------------------------------------------------------------
-- routines: personal (group_id null) or shared with exactly one of the
-- owner's groups. Never a snapshot itself — a workout_session started from
-- one copies what it needs (see below), so editing or deleting a routine
-- later never rewrites history.
-- ----------------------------------------------------------------------------
create table routines (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references profiles (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routines_owner_idx on routines (owner_user_id);
create index routines_group_idx on routines (group_id) where group_id is not null;

create table routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines (id) on delete cascade,
  exercise_id uuid not null references exercises (id),
  sort_order int not null,
  target_sets int not null check (target_sets between 1 and 20),
  target_reps int not null check (target_reps between 1 and 100),
  target_weight_kg numeric(6, 2) check (target_weight_kg is null or target_weight_kg >= 0),
  notes text check (notes is null or char_length(notes) <= 200),
  unique (routine_id, sort_order)
);
create index routine_exercises_routine_idx on routine_exercises (routine_id);

alter table routines enable row level security;
alter table routine_exercises enable row level security;

create policy routines_select on routines for select
  using (owner_user_id = auth.uid() or (group_id is not null and is_group_member(group_id)));
create policy routine_exercises_select on routine_exercises for select
  using (exists (
    select 1 from routines r where r.id = routine_exercises.routine_id
      and (r.owner_user_id = auth.uid() or (r.group_id is not null and is_group_member(r.group_id)))
  ));

revoke insert, update, delete on routines from authenticated;
revoke insert, update, delete on routine_exercises from authenticated;

-- ----------------------------------------------------------------------------
-- workout_sessions / workout_session_exercises / workout_sets: the live log.
-- A session started from a routine copies that routine's exercises (and
-- their targets) into workout_session_exercises at start time — a snapshot,
-- same idiom as league_cycles freezing its own prize splits — so editing
-- the routine afterwards never touches a session already in progress or in
-- the past, and deleting the routine only detaches the label (routine_id
-- set null) while routine_name_snapshot keeps saying what it was called.
-- A freeform session (routine_id null) has no session_exercises to start
-- with — they get added one at a time as the workout happens.
--
-- workout_sets is append-only in normal use: log_set adds the next set,
-- update_set/delete_set only touch a set that still belongs to an
-- in_progress session (never rewrite a finished workout — same "don't
-- touch settled history" rule the rest of this app already follows for
-- weekly_evaluation_results).
-- ----------------------------------------------------------------------------
create table workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  routine_id uuid references routines (id) on delete set null,
  routine_name_snapshot text,
  checkin_id uuid references checkins (id) on delete set null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index workout_sessions_user_idx on workout_sessions (user_id, started_at desc);
-- At most one workout in progress per person at a time.
create unique index workout_sessions_one_in_progress_idx on workout_sessions (user_id) where (status = 'in_progress');

create table workout_session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references workout_sessions (id) on delete cascade,
  exercise_id uuid not null references exercises (id),
  sort_order int not null,
  target_sets int check (target_sets is null or target_sets between 1 and 20),
  target_reps int check (target_reps is null or target_reps between 1 and 100),
  target_weight_kg numeric(6, 2) check (target_weight_kg is null or target_weight_kg >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, sort_order)
);
create index workout_session_exercises_session_idx on workout_session_exercises (session_id);
-- The read side of progressive overload ("what did I do last time on THIS exercise") scans this.
create index workout_session_exercises_exercise_idx on workout_session_exercises (exercise_id, session_id);

create table workout_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references workout_session_exercises (id) on delete cascade,
  set_number int not null check (set_number >= 1),
  reps int not null check (reps between 1 and 200),
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg >= 0),
  is_warmup boolean not null default false,
  completed_at timestamptz not null default now(),
  unique (session_exercise_id, set_number)
);
create index workout_sets_session_exercise_idx on workout_sets (session_exercise_id);

alter table workout_sessions enable row level security;
alter table workout_session_exercises enable row level security;
alter table workout_sets enable row level security;

create policy workout_sessions_select on workout_sessions for select
  using (user_id = auth.uid() or shares_active_group_with(user_id));
create policy workout_session_exercises_select on workout_session_exercises for select
  using (exists (
    select 1 from workout_sessions s where s.id = workout_session_exercises.session_id
      and (s.user_id = auth.uid() or shares_active_group_with(s.user_id))
  ));
create policy workout_sets_select on workout_sets for select
  using (exists (
    select 1 from workout_session_exercises se
      join workout_sessions s on s.id = se.session_id
      where se.id = workout_sets.session_exercise_id
        and (s.user_id = auth.uid() or shares_active_group_with(s.user_id))
  ));

revoke insert, update, delete on workout_sessions from authenticated;
revoke insert, update, delete on workout_session_exercises from authenticated;
revoke insert, update, delete on workout_sets from authenticated;

-- ----------------------------------------------------------------------------
-- validate_routine_exercises: shared shape-check for the jsonb exercise list
-- both create_routine and update_routine take —
-- '[{"exercise_id": "...", "target_sets": 4, "target_reps": 8, "target_weight": 60, "notes": "..."}, ...]'.
-- target_weight is in whatever unit the caller's create_routine/update_routine
-- call declares (p_unit) — this only checks it's a non-negative number, the
-- kg conversion happens where it's inserted, via to_kg().
-- Raises on the first problem found; returns nothing (called for its side effect only).
-- ----------------------------------------------------------------------------
create or replace function validate_routine_exercises(p_exercises jsonb)
returns void
language plpgsql
stable
as $$
declare
  v_item jsonb;
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
    if coalesce((v_item ->> 'target_sets')::int, 0) not between 1 and 20 then
      raise exception 'las series objetivo deben estar entre 1 y 20';
    end if;
    if coalesce((v_item ->> 'target_reps')::int, 0) not between 1 and 100 then
      raise exception 'las repeticiones objetivo deben estar entre 1 y 100';
    end if;
    if (v_item ->> 'target_weight') is not null and (v_item ->> 'target_weight')::numeric < 0 then
      raise exception 'el peso objetivo no puede ser negativo';
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_routine / update_routine / delete_routine.
-- Group sharing requires the caller to currently be a member of that group.
-- Editing/deleting a routine is allowed for its owner, or — for a
-- group-shared one — the group's admin too (so an admin can clean up a
-- routine left behind by someone who's since left), matching the
-- admin-override shape used all over this app (photo challenges, KOTH,
-- rule proposals).
-- ----------------------------------------------------------------------------
create or replace function create_routine(p_name text, p_exercises jsonb, p_group_id uuid default null, p_unit text default 'kg')
returns routines
language plpgsql
security definer
set search_path = public
as $$
declare
  v_routine routines%rowtype;
  v_item jsonb;
  v_idx int := 0;
begin
  if p_group_id is not null and not is_group_member(p_group_id) then
    raise exception 'no eres miembro de ese grupo';
  end if;
  perform validate_routine_exercises(p_exercises);

  insert into routines (owner_user_id, group_id, name)
    values (auth.uid(), p_group_id, btrim(p_name))
    returning * into v_routine;

  for v_item in select * from jsonb_array_elements(p_exercises) loop
    v_idx := v_idx + 1;
    insert into routine_exercises (routine_id, exercise_id, sort_order, target_sets, target_reps, target_weight_kg, notes)
      values (
        v_routine.id, (v_item ->> 'exercise_id')::uuid, v_idx,
        (v_item ->> 'target_sets')::int, (v_item ->> 'target_reps')::int,
        to_kg((v_item ->> 'target_weight')::numeric, p_unit), nullif(v_item ->> 'notes', '')
      );
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
  v_idx int := 0;
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

  delete from routine_exercises where routine_id = p_routine_id;
  for v_item in select * from jsonb_array_elements(p_exercises) loop
    v_idx := v_idx + 1;
    insert into routine_exercises (routine_id, exercise_id, sort_order, target_sets, target_reps, target_weight_kg, notes)
      values (
        p_routine_id, (v_item ->> 'exercise_id')::uuid, v_idx,
        (v_item ->> 'target_sets')::int, (v_item ->> 'target_reps')::int,
        to_kg((v_item ->> 'target_weight')::numeric, p_unit), nullif(v_item ->> 'notes', '')
      );
  end loop;

  return v_routine;
end;
$$;

create or replace function delete_routine(p_routine_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_routine routines%rowtype;
begin
  select * into v_routine from routines where id = p_routine_id;
  if not found then
    return;
  end if;
  if v_routine.owner_user_id <> auth.uid()
    and not (v_routine.group_id is not null and is_group_admin(v_routine.group_id)) then
    raise exception 'no puedes borrar esta rutina';
  end if;
  delete from routines where id = p_routine_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Live session RPCs. No screen calls these yet (that's a later phase) —
-- built now so the whole backend is exercised and tested together.
-- ----------------------------------------------------------------------------

-- start_workout_session: resume-or-create. If the caller already has a
-- session in_progress, it's returned unchanged (p_routine_id/p_checkin_id
-- are ignored) — starting is idempotent, so a client can always just call
-- this rather than track locally whether one is already open. To actually
-- abandon one and start over, delete_workout_session first.
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
      insert into workout_session_exercises (session_id, exercise_id, sort_order, target_sets, target_reps, target_weight_kg)
        values (v_session.id, v_re.exercise_id, v_re.sort_order, v_re.target_sets, v_re.target_reps, v_re.target_weight_kg);
    end loop;
  end if;

  return v_session;
end;
$$;

-- add_session_exercise: append an exercise to an in-progress session, no
-- target (freeform addition — whether the session itself started from a
-- routine or not, an exercise added this way was NOT part of that plan).
create or replace function add_session_exercise(p_session_id uuid, p_exercise_id uuid)
returns workout_session_exercises
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session workout_sessions%rowtype;
  v_next_order int;
  v_row workout_session_exercises%rowtype;
begin
  select * into v_session from workout_sessions where id = p_session_id and user_id = auth.uid();
  if not found or v_session.status <> 'in_progress' then
    raise exception 'este entreno no está en curso';
  end if;
  if not exists (select 1 from exercises where id = p_exercise_id) then
    raise exception 'ejercicio no encontrado';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_next_order
    from workout_session_exercises where session_id = p_session_id;

  insert into workout_session_exercises (session_id, exercise_id, sort_order)
    values (p_session_id, p_exercise_id, v_next_order)
    returning * into v_row;
  return v_row;
end;
$$;

-- p_weight/p_unit: the member's own input, in whatever unit they're
-- currently using (profiles.weight_unit) — converted to canonical kg here,
-- server-side, same as create_routine/update_routine and submit_koth_claim.
create or replace function log_set(p_session_exercise_id uuid, p_reps int, p_weight numeric default null, p_unit text default 'kg', p_is_warmup boolean default false)
returns workout_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_status text;
  v_next_set int;
  v_weight_kg numeric;
  v_row workout_sets%rowtype;
begin
  select s.status into v_session_status
    from workout_session_exercises se join workout_sessions s on s.id = se.session_id
    where se.id = p_session_exercise_id and s.user_id = auth.uid();
  if v_session_status is null or v_session_status <> 'in_progress' then
    raise exception 'este entreno no está en curso';
  end if;
  if p_reps is null or p_reps <= 0 then
    raise exception 'las repeticiones deben ser mayores a 0';
  end if;
  if p_weight is not null and p_weight < 0 then
    raise exception 'el peso no puede ser negativo';
  end if;
  v_weight_kg := to_kg(p_weight, p_unit);

  select coalesce(max(set_number), 0) + 1 into v_next_set from workout_sets where session_exercise_id = p_session_exercise_id;

  insert into workout_sets (session_exercise_id, set_number, reps, weight_kg, is_warmup)
    values (p_session_exercise_id, v_next_set, p_reps, v_weight_kg, coalesce(p_is_warmup, false))
    returning * into v_row;
  return v_row;
end;
$$;

-- update_set / delete_set: only while the parent session is still
-- in_progress — a finished workout's numbers don't get rewritten later,
-- same rule weekly_evaluation_results already follows.
create or replace function update_set(p_set_id uuid, p_reps int, p_weight numeric default null, p_unit text default 'kg', p_is_warmup boolean default false)
returns workout_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_status text;
  v_weight_kg numeric;
  v_row workout_sets%rowtype;
begin
  select s.status into v_session_status
    from workout_sets ws
      join workout_session_exercises se on se.id = ws.session_exercise_id
      join workout_sessions s on s.id = se.session_id
    where ws.id = p_set_id and s.user_id = auth.uid();
  if v_session_status is null or v_session_status <> 'in_progress' then
    raise exception 'ya no puedes editar este entreno';
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
  v_session_status text;
begin
  select s.status into v_session_status
    from workout_sets ws
      join workout_session_exercises se on se.id = ws.session_exercise_id
      join workout_sessions s on s.id = se.session_id
    where ws.id = p_set_id and s.user_id = auth.uid();
  if v_session_status is null or v_session_status <> 'in_progress' then
    raise exception 'ya no puedes editar este entreno';
  end if;

  delete from workout_sets where id = p_set_id;
end;
$$;

create or replace function finish_workout_session(p_session_id uuid, p_notes text default null)
returns workout_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session workout_sessions%rowtype;
begin
  select * into v_session from workout_sessions where id = p_session_id and user_id = auth.uid();
  if not found or v_session.status <> 'in_progress' then
    raise exception 'este entreno no está en curso';
  end if;

  update workout_sessions set status = 'completed', finished_at = now(), notes = nullif(p_notes, '')
    where id = p_session_id
    returning * into v_session;
  return v_session;
end;
$$;

-- delete_workout_session: for either abandoning one still in_progress, or
-- removing a completed one logged by mistake — the owner can always do
-- either. Cascades to its session_exercises/sets.
create or replace function delete_workout_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from workout_sessions where id = p_session_id and user_id = auth.uid();
end;
$$;
