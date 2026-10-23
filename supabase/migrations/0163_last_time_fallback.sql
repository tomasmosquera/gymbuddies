-- ============================================================================
-- ANTERIOR only ever looked at THIS SAME routine's own history, so a brand
-- new routine (or an exercise just swapped into one) always showed a dash
-- there even when the member has logged that exact exercise plenty of times
-- in some other routine. Falls back to the most recent completed session of
-- ANY routine (or freeform) that logged this exercise with a weight, same
-- set-by-set matching as the same-routine lookup — flagged per set via the
-- new is_last_time column so the UI can relabel the column "ÚLTIMA VEZ"
-- instead of "ANTERIOR" when it's showing that fallback.
--
-- Progressive Overload's bump still only ever reads a same-routine hit
-- (v_should_bump) — a hit from a different routine's own rep scheme doesn't
-- necessarily mean anything here, so the fallback never adds the increment,
-- only the raw last-time weight/reps.
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
  v_same_routine_session_id uuid;
  v_source_session_id uuid;
  v_is_last_time boolean;
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
      select s.id into v_same_routine_session_id
        from workout_sessions s
        join workout_session_exercises wse on wse.session_id = s.id
        join workout_sets ws on ws.session_exercise_id = wse.id
        where s.routine_id = p_routine_id and s.user_id = auth.uid() and s.status = 'completed'
          and wse.exercise_id = v_re.exercise_id
          and ws.weight_kg is not null
        order by s.started_at desc
        limit 1;

      v_source_session_id := v_same_routine_session_id;
      v_is_last_time := false;
      if v_source_session_id is null then
        select s.id into v_source_session_id
          from workout_sessions s
          join workout_session_exercises wse on wse.session_id = s.id
          join workout_sets ws on ws.session_exercise_id = wse.id
          where s.user_id = auth.uid() and s.status = 'completed'
            and wse.exercise_id = v_re.exercise_id
            and ws.weight_kg is not null
          order by s.started_at desc
          limit 1;
        if v_source_session_id is not null then
          v_is_last_time := true;
        end if;
      end if;

      -- Only the MOST RECENT qualifying session's own hit matters — this is
      -- "did you crush it last time", not a streak requirement. Deliberately
      -- reads v_same_routine_session_id, never the any-routine fallback.
      v_should_bump := false;
      if v_same_routine_session_id is not null and v_po_enabled then
        select coalesce(wse.progressive_overload_hit, false) into v_should_bump
          from workout_session_exercises wse
          where wse.session_id = v_same_routine_session_id and wse.exercise_id = v_re.exercise_id;
      end if;

      v_snapshot := '[]'::jsonb;
      v_last_raw_weight_kg := null;
      v_last_reps := null;
      v_last_suggested_weight_kg := null;
      for v_set in select * from routine_exercise_sets where routine_exercise_id = v_re.id order by set_number loop
        v_this_weight_kg := null;
        v_this_reps := null;
        if v_source_session_id is not null then
          select ws.weight_kg, ws.reps into v_this_weight_kg, v_this_reps
            from workout_session_exercises wse
            join workout_sets ws on ws.session_exercise_id = wse.id
            where wse.session_id = v_source_session_id and wse.exercise_id = v_re.exercise_id and ws.set_number = v_set.set_number;
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
          'is_progressive_overload_suggestion', v_is_po_suggestion,
          'is_last_time', v_is_last_time
        );
      end loop;

      insert into workout_session_exercises (session_id, exercise_id, sort_order, target_sets_snapshot, rest_seconds)
        values (v_session.id, v_re.exercise_id, v_re.sort_order, v_snapshot, v_re.rest_seconds);
    end loop;
  end if;

  return v_session;
end;
$$;
