-- ============================================================================
-- The Apple Health "Calorías" stat read whatever the phone/watch passively
-- recorded between check-in and checkout — with no Apple Watch actively
-- tracking a workout, a phone's own accelerometer-based estimate badly
-- undercounts resistance training (a real 60-minute session showing ~57kcal,
-- per direct user report). The app never told Health a workout was even
-- happening, so there was nothing better to read.
--
-- Client now computes its own MET-based estimate when a routine session
-- finishes (src/lib/domain/calorieEstimate.ts) using the session's actual
-- duration and the member's body weight — read live from Health/Health
-- Connect's own body-mass record when available, else profiles.
-- body_weight_kg if the member entered it, else a generic default. That
-- estimate is both stored on workout_sessions (for display) and written
-- BACK to Health/Health Connect as a completed workout (a new WRITE
-- permission — see appleHealth.ts/healthConnect.ts), which is also what
-- credits Apple's Exercise ring / Android's equivalent for that day, even
-- retroactively.
-- ============================================================================

alter table profiles add column body_weight_kg numeric check (body_weight_kg is null or body_weight_kg > 0);

create or replace function set_body_weight_kg(p_body_weight_kg numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_body_weight_kg is not null and p_body_weight_kg <= 0 then
    raise exception 'el peso corporal debe ser mayor a 0';
  end if;
  update profiles set body_weight_kg = p_body_weight_kg where id = auth.uid();
end;
$$;

alter table workout_sessions add column estimated_calories int check (estimated_calories is null or estimated_calories >= 0);

-- Signature changes (a new trailing param) — drop first so the old 2-arg
-- version doesn't stick around as a separate overload alongside this one.
drop function if exists finish_workout_session(uuid, text);

create or replace function finish_workout_session(p_session_id uuid, p_notes text default null, p_estimated_calories int default null)
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

  update workout_sessions
    set status = 'completed', finished_at = now(), notes = nullif(p_notes, ''), estimated_calories = p_estimated_calories
    where id = p_session_id
    returning * into v_session;
  return v_session;
end;
$$;
