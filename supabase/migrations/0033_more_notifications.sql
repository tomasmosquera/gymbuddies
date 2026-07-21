-- ============================================================================
-- Six more notification gaps, all additive to existing SECURITY DEFINER
-- functions/triggers — no behavior changes beyond the new push calls.
-- ============================================================================

-- 1. Recharge/deposit rejected — today only 'confirmed' notifies the member.
create or replace function apply_wallet_transaction_effect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    update group_members
      set balance = balance + new.amount,
          status = case
            when balance + new.amount > 0 and status in ('pending_deposit', 'needs_recharge') then 'active'
            else status
          end,
          activated_at = case
            when activated_at is null and balance + new.amount > 0 and status = 'pending_deposit' then now()
            else activated_at
          end
      where group_id = new.group_id and user_id = new.user_id;
  end if;

  if tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'confirmed'
     and new.type in ('recharge', 'initial_deposit') then
    perform send_push_notification(
      array[new.user_id], 'Gym Buddies', 'Tu recarga fue confirmada por el administrador.'
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'rejected'
     and new.type in ('recharge', 'initial_deposit') then
    perform send_push_notification(
      array[new.user_id], 'Gym Buddies', 'Tu recarga fue rechazada por el administrador. Revisa el comprobante y vuelve a intentarlo.'
    );
  end if;

  return new;
end;
$$;

-- 2. Admin sets a manual attendance override (no vote) — the affected member wasn't told.
create or replace function set_attendance_override(
  p_group_id uuid,
  p_user_id uuid,
  p_date date,
  p_status text,
  p_note text default null
)
returns attendance_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override attendance_overrides%rowtype;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can set attendance overrides';
  end if;
  if p_status not in ('valid', 'failed') then
    raise exception 'status must be valid or failed';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'user is not a member of this group';
  end if;

  insert into attendance_overrides (group_id, user_id, override_date, status, set_by, note)
    values (p_group_id, p_user_id, p_date, p_status, auth.uid(), p_note)
    on conflict (group_id, user_id, override_date)
    do update set status = excluded.status, set_by = excluded.set_by, note = excluded.note, created_at = now()
    returning * into v_override;

  perform send_push_notification(
    array[p_user_id], 'El admin ajustó tu asistencia',
    format(
      'El administrador marcó el %s como día %s.',
      to_char(p_date, 'DD/MM/YYYY'),
      case when p_status = 'valid' then 'válido' else 'fallado' end
    )
  );

  return v_override;
end;
$$;

-- 3. Admin deletes a member's check-in — notify them it's gone.
create or replace function admin_delete_checkin(p_checkin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
begin
  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_admin(v_checkin.group_id) then
    raise exception 'only the group admin can delete check-ins';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.photo_path;
  if v_checkin.checkout_photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_photo_path;
  end if;
  delete from checkins where id = p_checkin_id;

  perform send_push_notification(
    array[v_checkin.user_id], 'Tu check-in fue eliminado',
    format('El administrador eliminó tu check-in del %s.', to_char(v_checkin.checkin_date, 'DD/MM/YYYY'))
  );
end;
$$;

-- 4. Admin removes a member — notify them.
create or replace function admin_remove_member(p_member_id uuid)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
begin
  select * into v_member from group_members where id = p_member_id;
  if not found then
    raise exception 'member not found';
  end if;
  if not is_group_admin(v_member.group_id) then
    raise exception 'only the group admin can remove members';
  end if;
  if v_member.role = 'admin' then
    raise exception 'the group admin cannot be removed';
  end if;

  update group_members
    set status = 'removed', leave_requested_at = null, leave_effective_at = null
    where id = p_member_id
    returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Fuiste removido del grupo', 'El administrador te sacó del grupo.'
  );

  return v_member;
end;
$$;

-- 5. Admin cancels an in-progress rule vote — notify everyone who could vote.
-- Hooked as a trigger (not a new RPC) since the client already does this via
-- a plain `update rule_proposals set status = 'cancelled'` under the existing
-- column grant — no client change needed.
create or replace function notify_rule_proposal_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient_ids uuid[];
begin
  if new.status = 'cancelled' and old.status = 'pending' then
    select array_agg(user_id) into v_recipient_ids
      from group_members
      where group_id = new.group_id and status in ('active', 'needs_recharge') and user_id <> new.proposed_by;
    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Votación cancelada', 'El administrador canceló la propuesta de cambio de reglas en curso.'
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_notify_rule_proposal_cancelled
  after update of status on rule_proposals
  for each row execute function notify_rule_proposal_cancelled();

-- 6. Photo challenges — the challenger also learns the outcome, not just the
-- target. Same three resolution paths as before (live majority, timeout
-- sweep, admin direct decision), each now sending a second, differently
-- worded notification to challenged_by.
create or replace function resolve_photo_challenge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge photo_challenges%rowtype;
  v_checkin checkins%rowtype;
  v_yes int;
  v_no int;
  v_challenge_id uuid := coalesce(new.challenge_id, old.challenge_id);
begin
  select * into v_challenge from photo_challenges where id = v_challenge_id for update;
  if v_challenge.status <> 'pending' then
    return null;
  end if;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from photo_challenge_votes where challenge_id = v_challenge_id;

  if v_yes >= v_challenge.required_votes then
    update photo_challenges set status = 'invalid', decided_at = now() where id = v_challenge_id;
    select * into v_checkin from checkins where id = v_challenge.checkin_id;
    insert into attendance_overrides (group_id, user_id, override_date, status, set_by, note)
      values (
        v_challenge.group_id, v_challenge.target_user_id, v_checkin.checkin_date, 'failed',
        v_challenge.challenged_by, 'Foto invalidada por votación del grupo'
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
  elsif v_no > (v_challenge.member_count_snapshot - v_challenge.required_votes) then
    update photo_challenges set status = 'valid', decided_at = now() where id = v_challenge_id;
    perform send_push_notification(
      array[v_challenge.target_user_id], 'Tu foto fue validada', 'El grupo votó que tu check-in sí es válido.'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue rechazada', 'El grupo votó que el check-in que retaste sí es válido.'
    );
  end if;

  return null;
end;
$$;

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
      array[v_challenge.target_user_id], 'Tu foto fue validada', 'El administrador decidió que tu check-in sí es válido.'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue rechazada', 'El administrador decidió que el check-in que retaste sí es válido.'
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
      'El administrador decidió que tu check-in no era válido — ese día ahora cuenta como fallado.'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue aceptada', 'El administrador invalidó el check-in que retaste.'
    );
  end if;

  select * into v_challenge from photo_challenges where id = p_challenge_id;
  return v_challenge;
end;
$$;

create or replace function close_expired_photo_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge record;
  v_checkin checkins%rowtype;
  v_yes int;
begin
  for v_challenge in
    select * from photo_challenges where status = 'pending' and voting_closes_at <= now() for update
  loop
    select count(*) filter (where vote = 'yes') into v_yes
      from photo_challenge_votes where challenge_id = v_challenge.id;

    if v_yes >= v_challenge.required_votes then
      update photo_challenges set status = 'invalid', decided_at = now() where id = v_challenge.id;
      select * into v_checkin from checkins where id = v_challenge.checkin_id;
      insert into attendance_overrides (group_id, user_id, override_date, status, set_by, note)
        values (
          v_challenge.group_id, v_challenge.target_user_id, v_checkin.checkin_date, 'failed',
          v_challenge.challenged_by, 'Foto invalidada por votación del grupo'
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
    else
      update photo_challenges set status = 'valid', decided_at = now() where id = v_challenge.id;
      perform send_push_notification(
        array[v_challenge.target_user_id], 'Tu foto fue validada', 'El grupo votó que tu check-in sí es válido.'
      );
      perform send_push_notification(
        array[v_challenge.challenged_by], 'Tu votación fue rechazada', 'El grupo votó que el check-in que retaste sí es válido.'
      );
    end if;
  end loop;
end;
$$;
