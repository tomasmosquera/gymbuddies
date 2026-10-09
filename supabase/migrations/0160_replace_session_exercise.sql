-- ============================================================================
-- Lets a member swap an exercise for a different one in THIS workout session
-- only — e.g. the bench was taken, so they do dumbbell press instead, same as
-- if they'd always been doing that exercise today. Deliberately a
-- session-scoped update (workout_session_exercises.exercise_id), never
-- touches routine_exercises — the routine itself is unaffected, so the
-- original exercise shows up again next time this routine is started fresh.
-- The new exercise gets no plan of its own (target_sets_snapshot reset to
-- '[]', rest_seconds cleared), same as add_session_exercise's freeform
-- addition — it was never part of the routine's plan either. sort_order is
-- left untouched so the card stays in the same place in the list.
--
-- Any sets already logged against the OLD exercise are deleted first:
-- leaving them attached while relabeling the row would silently corrupt the
-- OLD exercise's own history (a set actually lifted as Press banca would
-- start showing up under Press banca con mancuernas instead). Same
-- destructive-by-design tradeoff as remove_session_exercise, and the client
-- warns about it the same way before calling this when there's something to
-- lose (see workout-session.tsx).
-- ============================================================================

create or replace function replace_session_exercise(p_session_exercise_id uuid, p_new_exercise_id uuid)
returns workout_session_exercises
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_status text;
  v_row workout_session_exercises%rowtype;
begin
  select s.status into v_session_status
    from workout_session_exercises se
      join workout_sessions s on s.id = se.session_id
    where se.id = p_session_exercise_id and s.user_id = auth.uid();
  if v_session_status is null or v_session_status <> 'in_progress' then
    raise exception 'este entreno no está en curso';
  end if;

  if not exists (select 1 from exercises where id = p_new_exercise_id) then
    raise exception 'ejercicio no encontrado';
  end if;

  delete from workout_sets where session_exercise_id = p_session_exercise_id;

  update workout_session_exercises
    set exercise_id = p_new_exercise_id,
        target_sets_snapshot = '[]'::jsonb,
        rest_seconds = null
    where id = p_session_exercise_id
    returning * into v_row;

  return v_row;
end;
$$;
