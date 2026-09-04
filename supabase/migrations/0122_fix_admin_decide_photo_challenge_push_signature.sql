-- 0121 rewrote admin_decide_photo_challenge's notification texts but
-- accidentally copied them from the stale 0033 version of the function,
-- which predates send_push_notification's p_group_id becoming a required
-- 4th parameter (fixed for this function back in 0051, then lost again by
-- 0121's copy-paste) — broke "Admin: validar/invalidar ahora" with "function
-- send_push_notification(uuid[], unknown, unknown) does not exist". Same
-- wording as 0121 intended, this time keeping the p_group_id/p_category
-- args admin_decide_koth_claim already had correctly.
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
      array[v_challenge.target_user_id], 'Tu foto fue validada', 'El grupo votó que tu check-in sí es válido.',
      p_group_id => v_challenge.group_id, p_category => 'votes'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue rechazada', 'El grupo votó que el check-in que retaste sí es válido.',
      p_group_id => v_challenge.group_id, p_category => 'votes'
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
      'El grupo votó que tu check-in no era válido — ese día ahora cuenta como fallado.',
      p_group_id => v_challenge.group_id, p_category => 'votes'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue aceptada', 'El grupo votó a favor de invalidar el check-in que retaste.',
      p_group_id => v_challenge.group_id, p_category => 'votes'
    );
  end if;

  select * into v_challenge from photo_challenges where id = p_challenge_id;
  return v_challenge;
end;
$$;
