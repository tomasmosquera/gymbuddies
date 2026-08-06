-- ============================================================================
-- Wording fix: KOTH push notifications said "rey/reina" — the product owner
-- wants it consistently "KOTH" instead ("¡Eres el nuevo KOTH de {exercise}!"
-- / "Volviste a ser el KOTH de {exercise}."). No behavior change, text only.
-- Full function bodies reproduced (create or replace requires it).
-- ============================================================================

create or replace function submit_koth_claim(
  p_group_id uuid,
  p_exercise_id uuid,
  p_value numeric,
  p_video_path text,
  p_unit text default null
)
returns koth_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exercise koth_exercises%rowtype;
  v_record koth_records%rowtype;
  v_current_claim koth_claims%rowtype;
  v_value_canonical numeric(8,3);
  v_eligible int;
  v_required int;
  v_claim koth_claims%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
  v_dethroned_user_id uuid;
  v_path_prefix text;
begin
  if not is_active_participant(p_group_id, auth.uid()) then
    raise exception 'solo los miembros activos pueden reclamar un récord';
  end if;

  select * into v_exercise from koth_exercises where id = p_exercise_id;
  if not found then
    raise exception 'ejercicio no encontrado';
  end if;

  if p_value is null or p_value <= 0 then
    raise exception 'el valor debe ser mayor a 0';
  end if;

  if v_exercise.metric_type = 'weight_kg' then
    if p_unit is null or p_unit not in ('kg', 'lbs') then
      raise exception 'debes indicar la unidad (kg o lbs)';
    end if;
    v_value_canonical := case when p_unit = 'lbs' then p_value * 0.45359237 else p_value end;
  else
    if p_unit is not null then
      raise exception 'este ejercicio no usa peso — no indiques unidad';
    end if;
    if p_value <> trunc(p_value) then
      raise exception 'las repeticiones deben ser un número entero';
    end if;
    v_value_canonical := p_value;
  end if;

  v_path_prefix := p_group_id::text || '/' || auth.uid()::text || '/';
  if p_video_path is null or left(p_video_path, length(v_path_prefix)) <> v_path_prefix then
    raise exception 'video inválido';
  end if;

  insert into koth_records (group_id, exercise_id) values (p_group_id, p_exercise_id)
    on conflict (group_id, exercise_id) do nothing;
  select * into v_record from koth_records where group_id = p_group_id and exercise_id = p_exercise_id for update;

  if v_record.current_claim_id is not null then
    select * into v_current_claim from koth_claims where id = v_record.current_claim_id for update;
    if v_value_canonical <= v_current_claim.value_canonical then
      raise exception 'tu marca no supera el récord actual';
    end if;
    if v_current_claim.status = 'pending_vote' then
      update koth_claims set status = 'valid', decided_at = now() where id = v_current_claim.id;
    end if;
    v_dethroned_user_id := v_current_claim.user_id;
  end if;

  v_eligible := greatest(count_eligible_voters(p_group_id) - 1, 0);
  v_required := majority_threshold(v_eligible);

  insert into koth_claims (
    group_id, exercise_id, user_id, metric_type, value_canonical, submitted_unit, submitted_value,
    video_path, required_votes, member_count_snapshot, voting_closes_at
  ) values (
    p_group_id, p_exercise_id, auth.uid(), v_exercise.metric_type, v_value_canonical, p_unit, p_value,
    p_video_path, v_required, v_eligible, now() + interval '72 hours'
  ) returning * into v_claim;

  update koth_records set current_claim_id = v_claim.id, updated_at = now() where id = v_record.id;

  select full_name into v_full_name from profiles where id = auth.uid();

  perform send_push_notification(
    array[auth.uid()], '¡Nuevo récord!',
    format('¡Eres el nuevo KOTH de %s!', v_exercise.name),
    p_group_id => p_group_id, p_category => 'achievements'
  );

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva reclamación de King of the Hill',
      format('%s reclamó el récord de %s — revisa el video y vota si algo no cuadra.', v_full_name, v_exercise.name),
      p_group_id => p_group_id, p_category => 'votes'
    );
  end if;

  if v_dethroned_user_id is not null and v_dethroned_user_id <> auth.uid() then
    perform send_push_notification(
      array[v_dethroned_user_id], 'Perdiste el trono',
      format('Tu récord de %s fue superado por %s.', v_exercise.name, v_full_name),
      p_group_id => p_group_id, p_category => 'group_activity'
    );
  end if;

  return v_claim;
end;
$$;

create or replace function try_resolve_koth_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim koth_claims%rowtype;
  v_exercise koth_exercises%rowtype;
  v_eligible int;
  v_required int;
  v_yes int;
  v_no int;
  v_full_name text;
  v_new_champion_id uuid;
begin
  select * into v_claim from koth_claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'pending_vote' then
    return;
  end if;

  v_eligible := greatest(count_eligible_voters(v_claim.group_id) - 1, 0);
  v_required := majority_threshold(v_eligible);
  update koth_claims set required_votes = v_required, member_count_snapshot = v_eligible where id = p_claim_id;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from koth_claim_votes where claim_id = p_claim_id;

  select * into v_exercise from koth_exercises where id = v_claim.exercise_id;
  select full_name into v_full_name from profiles where id = v_claim.user_id;

  if v_yes >= v_required then
    update koth_claims set status = 'invalidated', decided_at = now() where id = p_claim_id;
    perform refresh_koth_record(v_claim.group_id, v_claim.exercise_id);

    perform send_push_notification(
      array[v_claim.user_id], 'Tu récord fue invalidado',
      format('El grupo votó que tu reclamación de %s no era válida — perdiste el trono.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );

    select current_claim_id into v_new_champion_id from koth_records
      where group_id = v_claim.group_id and exercise_id = v_claim.exercise_id;
    if v_new_champion_id is not null then
      perform send_push_notification(
        array[(select user_id from koth_claims where id = v_new_champion_id)], 'Recuperaste el trono',
        format('Volviste a ser el KOTH de %s.', v_exercise.name),
        p_group_id => v_claim.group_id, p_category => 'achievements'
      );
    end if;
  elsif v_no > (v_eligible - v_required) then
    update koth_claims set status = 'valid', decided_at = now() where id = p_claim_id;
    perform send_push_notification(
      array[v_claim.user_id], 'Tu récord quedó confirmado',
      format('El grupo no logró invalidar tu reclamación de %s — el récord queda en pie.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );
  end if;
end;
$$;

create or replace function admin_decide_koth_claim(p_claim_id uuid, p_valid boolean)
returns koth_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim koth_claims%rowtype;
  v_exercise koth_exercises%rowtype;
  v_new_champion_id uuid;
begin
  select * into v_claim from koth_claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'pending_vote' then
    raise exception 'this claim is not open';
  end if;
  if not is_group_admin(v_claim.group_id) then
    raise exception 'only the group admin can decide this claim';
  end if;

  select * into v_exercise from koth_exercises where id = v_claim.exercise_id;

  if p_valid then
    update koth_claims set status = 'valid', decided_at = now(), decided_by = auth.uid() where id = p_claim_id
      returning * into v_claim;
    perform send_push_notification(
      array[v_claim.user_id], 'Tu récord quedó confirmado',
      format('El administrador confirmó tu reclamación de %s.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );
  else
    update koth_claims set status = 'invalidated', decided_at = now(), decided_by = auth.uid() where id = p_claim_id
      returning * into v_claim;
    perform refresh_koth_record(v_claim.group_id, v_claim.exercise_id);
    perform send_push_notification(
      array[v_claim.user_id], 'Tu récord fue invalidado',
      format('El administrador invalidó tu reclamación de %s.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );
    select current_claim_id into v_new_champion_id from koth_records
      where group_id = v_claim.group_id and exercise_id = v_claim.exercise_id;
    if v_new_champion_id is not null then
      perform send_push_notification(
        array[(select user_id from koth_claims where id = v_new_champion_id)], 'Recuperaste el trono',
        format('Volviste a ser el KOTH de %s.', v_exercise.name),
        p_group_id => v_claim.group_id, p_category => 'achievements'
      );
    end if;
  end if;

  return v_claim;
end;
$$;

create or replace function close_expired_koth_claims()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_exercise koth_exercises%rowtype;
  v_eligible int;
  v_required int;
  v_yes int;
  v_new_champion_id uuid;
begin
  for v_claim in
    select * from koth_claims where status = 'pending_vote' and voting_closes_at <= now() for update
  loop
    v_eligible := greatest(count_eligible_voters(v_claim.group_id) - 1, 0);
    v_required := majority_threshold(v_eligible);

    select count(*) filter (where vote = 'yes') into v_yes from koth_claim_votes where claim_id = v_claim.id;
    select * into v_exercise from koth_exercises where id = v_claim.exercise_id;

    if v_yes >= v_required then
      update koth_claims
        set status = 'invalidated', decided_at = now(), required_votes = v_required, member_count_snapshot = v_eligible
        where id = v_claim.id;
      perform refresh_koth_record(v_claim.group_id, v_claim.exercise_id);
      perform send_push_notification(
        array[v_claim.user_id], 'Tu récord fue invalidado',
        format('El grupo votó que tu reclamación de %s no era válida — perdiste el trono.', v_exercise.name),
        p_group_id => v_claim.group_id, p_category => 'votes'
      );
      select current_claim_id into v_new_champion_id from koth_records
        where group_id = v_claim.group_id and exercise_id = v_claim.exercise_id;
      if v_new_champion_id is not null then
        perform send_push_notification(
          array[(select user_id from koth_claims where id = v_new_champion_id)], 'Recuperaste el trono',
          format('Volviste a ser el KOTH de %s.', v_exercise.name),
          p_group_id => v_claim.group_id, p_category => 'achievements'
        );
      end if;
    else
      update koth_claims
        set status = 'valid', decided_at = now(), required_votes = v_required, member_count_snapshot = v_eligible
        where id = v_claim.id;
      perform send_push_notification(
        array[v_claim.user_id], 'Tu récord quedó confirmado',
        format(
          'El plazo de votación terminó sin que el grupo lograra invalidar tu reclamación de %s — el récord queda en pie.',
          v_exercise.name
        ),
        p_group_id => v_claim.group_id, p_category => 'votes'
      );
    end if;
  end loop;
end;
$$;
