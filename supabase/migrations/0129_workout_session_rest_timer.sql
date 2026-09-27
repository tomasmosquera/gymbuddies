-- ============================================================================
-- Fase 2 (live logging) needs the rest timer at hand while a session is
-- running, so it has to be part of the same frozen-at-start snapshot as
-- target_sets_snapshot — routine_exercises.rest_seconds itself can change
-- (or the routine can be deleted) while a session started from it is still
-- in_progress, and that must never alter a workout already underway.
-- ============================================================================
alter table workout_session_exercises add column rest_seconds int;

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

      insert into workout_session_exercises (session_id, exercise_id, sort_order, target_sets_snapshot, rest_seconds)
        values (v_session.id, v_re.exercise_id, v_re.sort_order, v_snapshot, v_re.rest_seconds);
    end loop;
  end if;

  return v_session;
end;
$$;
