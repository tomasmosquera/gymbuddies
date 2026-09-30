-- ============================================================================
-- Lets a member drop an exercise from THIS workout session only — e.g.
-- decided mid-Pull day not to do Pull Ups after all, and would rather it
-- just not be in today's list than sit there unchecked. Deliberately a
-- session-scoped delete (workout_session_exercises), never touches
-- routine_exercises — the routine itself is unaffected, so the same
-- exercise shows up again next time this routine is started fresh. Cascades
-- to workout_sets (see 0127's FK), so any sets already logged for it today
-- are discarded too — the client confirms that destructively before calling
-- this when there's something to lose (see workout-session.tsx).
-- ============================================================================

create or replace function remove_session_exercise(p_session_exercise_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_status text;
begin
  select s.status into v_session_status
    from workout_session_exercises se
      join workout_sessions s on s.id = se.session_id
    where se.id = p_session_exercise_id and s.user_id = auth.uid();
  if v_session_status is null or v_session_status <> 'in_progress' then
    raise exception 'este entreno no está en curso';
  end if;

  delete from workout_session_exercises where id = p_session_exercise_id;
end;
$$;
