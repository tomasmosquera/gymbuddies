-- ============================================================================
-- Two small live-session edits, both session-scoped only (workout_session_
-- exercises), same "today's workout, not the routine itself" idiom as
-- remove_session_exercise/replace_session_exercise — a routine's own
-- rest_seconds/notes are untouched, so the next time it's started fresh it's
-- back to whatever the routine itself plans.
--
-- 1. set_session_exercise_rest: lets a member adjust today's rest timer for
--    one exercise (the routine's own plan, or a freeform exercise that
--    started with none) — same 0-1800s bound validate_routine_exercises
--    already enforces for a routine's own rest_seconds. Null clears it.
--
-- 2. set_session_exercise_notes/workout_session_exercises.notes: a free-text
--    note for TODAY's instance of this exercise ("alternando cada brazo",
--    "8-9 RPE") — same 200-char bound as routine_exercises.notes.
-- ============================================================================
alter table workout_session_exercises add column notes text check (notes is null or char_length(notes) <= 200);

create or replace function set_session_exercise_rest(p_session_exercise_id uuid, p_rest_seconds int)
returns workout_session_exercises
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_status text;
  v_row workout_session_exercises%rowtype;
begin
  if p_rest_seconds is not null and p_rest_seconds not between 0 and 1800 then
    raise exception 'el descanso debe estar entre 0 y 1800 segundos';
  end if;

  select s.status into v_session_status
    from workout_session_exercises se
      join workout_sessions s on s.id = se.session_id
    where se.id = p_session_exercise_id and s.user_id = auth.uid();
  if v_session_status is null or v_session_status <> 'in_progress' then
    raise exception 'este entreno no está en curso';
  end if;

  update workout_session_exercises set rest_seconds = p_rest_seconds
    where id = p_session_exercise_id
    returning * into v_row;

  return v_row;
end;
$$;

create or replace function set_session_exercise_notes(p_session_exercise_id uuid, p_notes text)
returns workout_session_exercises
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_status text;
  v_row workout_session_exercises%rowtype;
  v_notes text;
begin
  v_notes := nullif(btrim(p_notes), '');
  if v_notes is not null and char_length(v_notes) > 200 then
    raise exception 'la nota no puede tener más de 200 caracteres';
  end if;

  select s.status into v_session_status
    from workout_session_exercises se
      join workout_sessions s on s.id = se.session_id
    where se.id = p_session_exercise_id and s.user_id = auth.uid();
  if v_session_status is null or v_session_status <> 'in_progress' then
    raise exception 'este entreno no está en curso';
  end if;

  update workout_session_exercises set notes = v_notes
    where id = p_session_exercise_id
    returning * into v_row;

  return v_row;
end;
$$;
