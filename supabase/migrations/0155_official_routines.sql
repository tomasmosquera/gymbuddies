-- ============================================================================
-- "Explorar rutinas": Gym Buddies' own curated routines, browsable by every
-- member regardless of group, filterable by level/goal/days-per-week (new
-- tags on routines — nothing in the schema carried this before) and by
-- equipment needed (NOT a new tag — derived client-side from which
-- exercises.equipment values the routine's own exercises already use, so it
-- can never drift out of sync with the actual exercise list).
--
-- An official routine is just a routine with is_official = true, owned by
-- the platform admin account (same one is_platform_admin already names,
-- 0089_public_groups.sql) and no group_id — nothing new on the ownership
-- model. Members never start one directly: "Copiar a mis rutinas" (reusing
-- useMyRoutines.ts's existing copyRoutine, unchanged) clones it into their
-- own routines first, exactly like copying a group-mate's shared routine
-- today. That sidesteps start_workout_session's own ownership check (it
-- requires owner_user_id = auth.uid() or group membership, deliberately not
-- touched here) and gives members an editable copy, consistent with how
-- every other routine in this app is used.
-- ============================================================================

alter table routines add column is_official boolean not null default false;
alter table routines add column level text check (level in ('principiante', 'intermedio', 'avanzado'));
alter table routines add column goal text check (goal in ('fuerza', 'hipertrofia', 'perdida_grasa', 'general'));
alter table routines add column days_per_week smallint check (days_per_week between 1 and 7);
create index routines_official_idx on routines (is_official) where is_official;

-- ---- RLS: official routines are readable by any authenticated member, same as a public group ----
drop policy routines_select on routines;
create policy routines_select on routines for select
  using (owner_user_id = auth.uid() or (group_id is not null and is_group_member(group_id)) or is_official);

drop policy routine_exercises_select on routine_exercises;
create policy routine_exercises_select on routine_exercises for select
  using (exists (
    select 1 from routines r where r.id = routine_exercises.routine_id
      and (r.owner_user_id = auth.uid() or (r.group_id is not null and is_group_member(r.group_id)) or r.is_official)
  ));

drop policy routine_exercise_sets_select on routine_exercise_sets;
create policy routine_exercise_sets_select on routine_exercise_sets for select
  using (exists (
    select 1 from routine_exercises re join routines r on r.id = re.routine_id
      where re.id = routine_exercise_sets.routine_exercise_id
        and (r.owner_user_id = auth.uid() or (r.group_id is not null and is_group_member(r.group_id)) or r.is_official)
  ));

-- is_official/level/goal/days_per_week are admin-authored, not member-editable — update_routine
-- never touches them (it only ever does `update routines set name = ...`), and routines/
-- routine_exercises/routine_exercise_sets already revoke insert/update/delete from authenticated
-- entirely, so nothing extra is needed to keep members from setting is_official on their own rows.

-- ---- Seed data: 10 well-known routines/programs, by exercise slug (not raw uuid) so this stays
-- readable — every slug here is one of the English-named ones 0128_routine_planned_sets.sql
-- renamed from the original seed, confirmed to exist before writing this migration.
create or replace function _seed_official_routine_exercise(
  p_routine_id uuid, p_exercise_slug text, p_sort int, p_rest_seconds int,
  p_num_sets int, p_reps_min int, p_reps_max int, p_notes text default null
) returns void
language plpgsql
as $$
declare
  v_exercise_id uuid;
  v_re_id uuid;
  v_i int;
begin
  select id into v_exercise_id from exercises where slug = p_exercise_slug;
  if v_exercise_id is null then
    raise exception 'seed exercise slug not found: %', p_exercise_slug;
  end if;
  insert into routine_exercises (routine_id, exercise_id, sort_order, rest_seconds, notes)
    values (p_routine_id, v_exercise_id, p_sort, p_rest_seconds, p_notes)
    returning id into v_re_id;
  for v_i in 1..p_num_sets loop
    insert into routine_exercise_sets (routine_exercise_id, set_number, target_reps_min, target_reps_max, is_failure_target)
      values (v_re_id, v_i, p_reps_min, p_reps_max, false);
  end loop;
end;
$$;

do $$
declare
  v_owner uuid;
  v_r uuid;
begin
  select id into v_owner from auth.users where email = 'tomasmosquera@hotmail.com';
  if v_owner is null then
    raise exception 'platform admin account not found, aborting official routine seed';
  end if;

  -- 1. StrongLifts 5x5 - Dia A
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'StrongLifts 5x5 - Dia A', true, 'principiante', 'fuerza', 3) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'back_squat', 1, 180, 5, 5, 5);
  perform _seed_official_routine_exercise(v_r, 'bench_press', 2, 180, 5, 5, 5);
  perform _seed_official_routine_exercise(v_r, 'barbell_row', 3, 180, 5, 5, 5);

  -- 2. StrongLifts 5x5 - Dia B
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'StrongLifts 5x5 - Dia B', true, 'principiante', 'fuerza', 3) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'back_squat', 1, 180, 5, 5, 5);
  perform _seed_official_routine_exercise(v_r, 'overhead_press', 2, 180, 5, 5, 5);
  perform _seed_official_routine_exercise(v_r, 'deadlift', 3, 180, 1, 5, 5);

  -- 3. Full Body sin equipo (principiante)
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'Full Body Sin Equipo', true, 'principiante', 'general', 3) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'push_ups', 1, 60, 3, 10, 15);
  perform _seed_official_routine_exercise(v_r, 'chin_ups', 2, 90, 3, 5, 8);
  perform _seed_official_routine_exercise(v_r, 'glute_bridge', 3, 45, 3, 12, 15);
  perform _seed_official_routine_exercise(v_r, 'plank', 4, 45, 3, 20, 30, 'segundos por serie, no repeticiones');
  perform _seed_official_routine_exercise(v_r, 'mountain_climbers', 5, 30, 3, 15, 20);
  perform _seed_official_routine_exercise(v_r, 'burpees', 6, 60, 3, 8, 10);

  -- 4. Push Pull Legs - Push
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'Push Pull Legs - Push', true, 'intermedio', 'hipertrofia', 6) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'bench_press', 1, 120, 4, 6, 10);
  perform _seed_official_routine_exercise(v_r, 'overhead_press', 2, 90, 3, 8, 10);
  perform _seed_official_routine_exercise(v_r, 'dumbbell_flyes', 3, 60, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'lateral_raise', 4, 45, 3, 12, 15);
  perform _seed_official_routine_exercise(v_r, 'triceps_pushdown', 5, 60, 3, 10, 12);

  -- 5. Push Pull Legs - Pull
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'Push Pull Legs - Pull', true, 'intermedio', 'hipertrofia', 6) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'deadlift', 1, 180, 3, 5, 5);
  perform _seed_official_routine_exercise(v_r, 'lat_pulldown', 2, 90, 4, 8, 10);
  perform _seed_official_routine_exercise(v_r, 'barbell_row', 3, 90, 3, 8, 10);
  perform _seed_official_routine_exercise(v_r, 'face_pull', 4, 45, 3, 12, 15);
  perform _seed_official_routine_exercise(v_r, 'dumbbell_curl', 5, 60, 3, 10, 12);

  -- 6. Push Pull Legs - Legs
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'Push Pull Legs - Legs', true, 'intermedio', 'hipertrofia', 6) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'back_squat', 1, 150, 4, 6, 8);
  perform _seed_official_routine_exercise(v_r, 'leg_press', 2, 90, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'lying_leg_curl', 3, 60, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'leg_extension', 4, 60, 3, 12, 15);
  perform _seed_official_routine_exercise(v_r, 'standing_calf_raise', 5, 45, 4, 12, 15);

  -- 7. Upper/Lower - Tren Superior
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'Upper Lower - Tren Superior', true, 'intermedio', 'hipertrofia', 4) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'bench_press', 1, 120, 4, 6, 10);
  perform _seed_official_routine_exercise(v_r, 'barbell_row', 2, 120, 4, 6, 10);
  perform _seed_official_routine_exercise(v_r, 'overhead_press', 3, 90, 3, 8, 10);
  perform _seed_official_routine_exercise(v_r, 'lat_pulldown', 4, 90, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'dumbbell_curl', 5, 60, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'triceps_pushdown', 6, 60, 3, 10, 12);

  -- 8. Upper/Lower - Tren Inferior
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'Upper Lower - Tren Inferior', true, 'intermedio', 'hipertrofia', 4) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'back_squat', 1, 150, 4, 6, 10);
  perform _seed_official_routine_exercise(v_r, 'hip_thrust', 2, 90, 3, 8, 10);
  perform _seed_official_routine_exercise(v_r, 'leg_press', 3, 90, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'lying_leg_curl', 4, 60, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'standing_calf_raise', 5, 45, 4, 12, 15);

  -- 9. Dumbbell Full Body (en casa)
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'Full Body con Mancuernas', true, 'principiante', 'general', 3) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'dumbbell_bench_press', 1, 90, 3, 8, 12);
  perform _seed_official_routine_exercise(v_r, 'dumbbell_row', 2, 90, 3, 8, 12);
  perform _seed_official_routine_exercise(v_r, 'dumbbell_shoulder_press', 3, 90, 3, 8, 12);
  perform _seed_official_routine_exercise(v_r, 'walking_lunges', 4, 60, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'stiff_leg_deadlift', 5, 90, 3, 10, 12);
  perform _seed_official_routine_exercise(v_r, 'dumbbell_curl', 6, 60, 3, 10, 12);

  -- 10. Circuito Quema Grasa
  insert into routines (owner_user_id, name, is_official, level, goal, days_per_week)
    values (v_owner, 'Circuito Quema Grasa', true, 'intermedio', 'perdida_grasa', 4) returning id into v_r;
  perform _seed_official_routine_exercise(v_r, 'kettlebell_swing', 1, 45, 4, 15, 20);
  perform _seed_official_routine_exercise(v_r, 'burpees', 2, 45, 4, 12, 15);
  perform _seed_official_routine_exercise(v_r, 'goblet_squat', 3, 45, 4, 12, 15);
  perform _seed_official_routine_exercise(v_r, 'mountain_climbers', 4, 30, 4, 20, 30);
  perform _seed_official_routine_exercise(v_r, 'push_ups', 5, 45, 4, 10, 15);
  perform _seed_official_routine_exercise(v_r, 'seated_cable_row', 6, 45, 3, 12, 15);
end $$;

drop function _seed_official_routine_exercise(uuid, text, int, int, int, int, int, text);
