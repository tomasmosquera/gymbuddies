-- ============================================================================
-- A member still inside their protection period (activated_at in the future
-- — the group-wide game_starts_at floor, or an admin-set per-member date)
-- could already do everything else in the app "for practice" without it
-- counting for real: checkins, reactions, votes — see is_voting_member vs.
-- is_active_participant, and every downstream ranking/badge/consistency
-- consumer already filtering by activated_at. King of the Hill was the one
-- gap: submit_koth_claim required is_active_participant (protected members
-- got a flat error, couldn't even try it), and if it had let them through it
-- would have crowned them immediately, dethroning whoever actually holds the
-- record — a real positive/negative effect on other members' real game
-- state, from someone who isn't really playing yet.
--
-- Fix: protected members can now submit a claim (same flow, same "must beat
-- the current record" check, same video upload) but it's marked
-- counts_for_record = false — recorded for their own history, immediately
-- finalized (no vote needed, nothing to invalidate), and never touches
-- koth_records or anyone else's throne. Once their protection ends, a new
-- claim is a normal, real one; the practice claim never retroactively
-- counts, same as a protected day never retroactively joins their
-- consistency history once activated_at is reached (see badges.ts's `days`).
-- ============================================================================

alter table koth_claims add column counts_for_record boolean not null default true;

-- ============================================================================
-- refresh_koth_record: must never fall back to a practice claim as "the next
-- champion" — a non-counting claim was never really champion of anything,
-- even momentarily, so it has no business becoming the record just because
-- it's the most recent row left after the real champion's claim was
-- invalidated/deleted.
-- ============================================================================
create or replace function refresh_koth_record(p_group_id uuid, p_exercise_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_claim_id uuid;
begin
  select id into v_next_claim_id
    from koth_claims
    where group_id = p_group_id and exercise_id = p_exercise_id and status <> 'invalidated' and counts_for_record
    order by created_at desc limit 1;

  insert into koth_records (group_id, exercise_id, current_claim_id, updated_at)
    values (p_group_id, p_exercise_id, v_next_claim_id, now())
  on conflict (group_id, exercise_id)
    do update set current_claim_id = excluded.current_claim_id, updated_at = now();
end;
$$;

-- ============================================================================
-- submit_koth_claim: widened gate (is_voting_member instead of
-- is_active_participant — matches every other "can this member act at all"
-- gate in the app), plus the counts_for_record branch described above.
-- Built on top of 0085's "KOTH" wording (not "rey/reina") — same text,
-- unchanged for the real-claim path.
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
  v_activated_at timestamptz;
  v_counts_for_record boolean;
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'solo los miembros del grupo pueden reclamar un récord';
  end if;

  select coalesce(activated_at, joined_at) into v_activated_at
    from group_members where group_id = p_group_id and user_id = auth.uid();
  v_counts_for_record := v_activated_at is not null and v_activated_at <= now();

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

  -- The record to beat is always the real one — a practice claim never
  -- touches current_claim_id, so this comparison is automatically correct
  -- for both real and practice submissions with no extra branching needed.
  if v_record.current_claim_id is not null then
    select * into v_current_claim from koth_claims where id = v_record.current_claim_id for update;
    if v_value_canonical <= v_current_claim.value_canonical then
      raise exception 'tu marca no supera el récord actual';
    end if;
  end if;

  select full_name into v_full_name from profiles where id = auth.uid();

  if v_counts_for_record then
    if v_record.current_claim_id is not null and v_current_claim.status = 'pending_vote' then
      update koth_claims set status = 'valid', decided_at = now() where id = v_current_claim.id;
    end if;
    if v_record.current_claim_id is not null then
      v_dethroned_user_id := v_current_claim.user_id;
    end if;

    v_eligible := greatest(count_eligible_voters(p_group_id) - 1, 0);
    v_required := majority_threshold(v_eligible);

    insert into koth_claims (
      group_id, exercise_id, user_id, metric_type, value_canonical, submitted_unit, submitted_value,
      video_path, counts_for_record, required_votes, member_count_snapshot, voting_closes_at
    ) values (
      p_group_id, p_exercise_id, auth.uid(), v_exercise.metric_type, v_value_canonical, p_unit, p_value,
      p_video_path, true, v_required, v_eligible, now() + interval '72 hours'
    ) returning * into v_claim;

    update koth_records set current_claim_id = v_claim.id, updated_at = now() where id = v_record.id;

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
  else
    -- Practice claim: still beat the real record above, still recorded, but
    -- finalized immediately with nothing to vote on and koth_records left
    -- completely untouched — no crown, no dethroning, no group-wide "new
    -- claim to review" push.
    insert into koth_claims (
      group_id, exercise_id, user_id, metric_type, value_canonical, submitted_unit, submitted_value,
      video_path, counts_for_record, status, required_votes, member_count_snapshot, voting_closes_at, decided_at
    ) values (
      p_group_id, p_exercise_id, auth.uid(), v_exercise.metric_type, v_value_canonical, p_unit, p_value,
      p_video_path, false, 'valid', 0, 0, now(), now()
    ) returning * into v_claim;

    perform send_push_notification(
      array[auth.uid()], 'Marca de práctica guardada',
      format(
        'Superaste el récord actual de %s, pero como todavía estás en tu período de prueba no cuenta como récord real — vuelve a intentarlo cuando termine tu protección.',
        v_exercise.name
      ),
      p_group_id => p_group_id, p_category => 'achievements'
    );
  end if;

  return v_claim;
end;
$$;
