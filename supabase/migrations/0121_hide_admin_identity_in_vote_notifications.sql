-- When the admin decides a photo challenge or a KOTH claim directly
-- (bypassing the vote), the push notifications used to say "El administrador
-- decidió/confirmó/invalidó...", giving away that it was the admin and not
-- the group's vote. Members shouldn't be able to tell the difference — same
-- wording either way, matching the group-vote-resolution texts exactly. No
-- behavior change beyond notification copy: the underlying status update,
-- attendance_overrides.note (an admin-only audit trail, never shown to
-- members), and decided_by column are untouched.
create or replace function admin_decide_photo_challenge(p_challenge_id uuid, p_valid boolean)
returns photo_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge photo_challenges%rowtype;
  v_checkin checkins%rowtype;
begin
  select * into v_challenge from photo_challenges where id = p_challenge_id for update;
  if not found or v_challenge.status <> 'pending' then
    raise exception 'this challenge is not open';
  end if;
  if not is_group_admin(v_challenge.group_id) then
    raise exception 'only the group admin can decide directly';
  end if;

  if p_valid then
    update photo_challenges set status = 'valid', decided_at = now(), decided_by = auth.uid() where id = p_challenge_id;
    perform send_push_notification(
      array[v_challenge.target_user_id], 'Tu foto fue validada', 'El grupo votó que tu check-in sí es válido.'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue rechazada', 'El grupo votó que el check-in que retaste sí es válido.'
    );
  else
    update photo_challenges set status = 'invalid', decided_at = now(), decided_by = auth.uid() where id = p_challenge_id;
    select * into v_checkin from checkins where id = v_challenge.checkin_id;
    insert into attendance_overrides (group_id, user_id, override_date, status, set_by, note)
      values (
        v_challenge.group_id, v_challenge.target_user_id, v_checkin.checkin_date, 'failed',
        auth.uid(), 'Foto invalidada por el administrador'
      )
      on conflict (group_id, user_id, override_date)
      do update set status = 'failed', set_by = excluded.set_by, note = excluded.note, created_at = now();
    perform send_push_notification(
      array[v_challenge.target_user_id], 'Tu foto fue invalidada',
      'El grupo votó que tu check-in no era válido — ese día ahora cuenta como fallado.'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue aceptada', 'El grupo votó a favor de invalidar el check-in que retaste.'
    );
  end if;

  select * into v_challenge from photo_challenges where id = p_challenge_id;
  return v_challenge;
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
      format('El grupo no logró invalidar tu reclamación de %s — el récord queda en pie.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );
  else
    update koth_claims set status = 'invalidated', decided_at = now(), decided_by = auth.uid() where id = p_claim_id
      returning * into v_claim;
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
  end if;

  return v_claim;
end;
$$;
