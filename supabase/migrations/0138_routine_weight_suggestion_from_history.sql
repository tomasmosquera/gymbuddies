-- ============================================================================
-- Starting a routine used to always pre-fill the weight/reps you set when you
-- CREATED it — even months later, after you'd long since progressed past
-- that number. It now suggests the weight you actually lifted the last time
-- you did THIS SAME routine (matched set-by-set), only falling back to the
-- routine's own static plan when this routine has no such history yet.
--
-- Per set, in order:
--   1. Find the most recent COMPLETED session of this same routine where
--      this exercise had at least one set logged with a real weight. A more
--      recent session where this exercise was skipped/had 0 sets, or was
--      logged with no weight at all, is passed over — exactly like walking
--      further back in your own logbook.
--   2. Within THAT session, take the weight/reps logged at the matching set
--      number. If that exact position has no weight (e.g. it was a set
--      logged without one) or doesn't exist at all (today's routine now
--      plans more sets than were logged then), carry forward the last
--      position that did have one — same idea as "+ Agregar serie" already
--      copying the previous row forward.
--   3. Still nothing at all for this exercise, ever, in this routine? Keep
--      today's behavior: the routine's own static target_weight_kg.
--
-- previous_weight_kg/previous_reps carry that same lookup's raw answer
-- (never falling back to the routine's plan) — the UI's new read-only
-- "Anterior" column reads directly from these, so it always agrees with
-- why target_weight_kg is what it is. Reps sugeridos (target_reps) are
-- untouched — still always the routine's own goal, by explicit product
-- decision (only the weight adapts to history).
-- ============================================================================

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
  v_last_weight_kg numeric;
  v_last_reps int;
  v_suggested_weight_kg numeric;
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
      select s.id into v_prev_session_id
        from workout_sessions s
        join workout_session_exercises wse on wse.session_id = s.id
        join workout_sets ws on ws.session_exercise_id = wse.id
        where s.routine_id = p_routine_id and s.user_id = auth.uid() and s.status = 'completed'
          and wse.exercise_id = v_re.exercise_id
          and ws.weight_kg is not null
        order by s.started_at desc
        limit 1;

      v_snapshot := '[]'::jsonb;
      v_last_weight_kg := null;
      v_last_reps := null;
      for v_set in select * from routine_exercise_sets where routine_exercise_id = v_re.id order by set_number loop
        v_this_weight_kg := null;
        v_this_reps := null;
        if v_prev_session_id is not null then
          select ws.weight_kg, ws.reps into v_this_weight_kg, v_this_reps
            from workout_session_exercises wse
            join workout_sets ws on ws.session_exercise_id = wse.id
            where wse.session_id = v_prev_session_id and wse.exercise_id = v_re.exercise_id and ws.set_number = v_set.set_number;
          if v_this_weight_kg is not null then
            v_last_weight_kg := v_this_weight_kg;
            v_last_reps := v_this_reps;
          end if;
        end if;
        v_suggested_weight_kg := coalesce(v_last_weight_kg, v_set.target_weight_kg);

        v_snapshot := v_snapshot || jsonb_build_object(
          'target_reps', v_set.target_reps, 'target_weight_kg', v_suggested_weight_kg, 'is_failure_target', v_set.is_failure_target,
          'previous_weight_kg', v_last_weight_kg, 'previous_reps', v_last_reps
        );
      end loop;

      insert into workout_session_exercises (session_id, exercise_id, sort_order, target_sets_snapshot, rest_seconds)
        values (v_session.id, v_re.exercise_id, v_re.sort_order, v_snapshot, v_re.rest_seconds);
    end loop;
  end if;

  return v_session;
end;
$$;
