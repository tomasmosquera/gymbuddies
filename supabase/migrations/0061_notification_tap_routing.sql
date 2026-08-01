-- ============================================================================
-- Lets tapping a notification (in-app inbox, or a real push) open the
-- screen it's actually about. `category` (already on every notification) is
-- the default router client-side; a handful of call sites where the
-- category's default destination is wrong for that specific case now pass
-- an explicit `p_data.route` string that the client checks first.
--
-- A tapped PUSH notification only ever has the push payload's own `data` to
-- work with (no DB round-trip before navigating), so `category` and
-- `group_id` — already known server-side, already stored on the
-- `notifications` row — now get folded into the outgoing Expo push `data`
-- too, not just whatever ad-hoc `p_data` a caller passed. This is the only
-- change to send_push_notification itself; every existing call site keeps
-- working unchanged, and the stored `notifications.data` column is
-- unaffected (still exactly what the caller passed).
-- ============================================================================
create or replace function send_push_notification(
  p_user_ids uuid[], p_title text, p_body text, p_group_id uuid,
  p_data jsonb default '{}'::jsonb, p_category text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eligible_user_ids uuid[];
  v_messages jsonb;
begin
  select array_agg(gm.user_id) into v_eligible_user_ids
    from group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = any(p_user_ids)
      and (p_category is null or coalesce((gm.notification_preferences ->> p_category)::boolean, true));

  if v_eligible_user_ids is null then
    return;
  end if;

  insert into notifications (user_id, group_id, title, body, category, data)
    select uid, p_group_id, p_title, p_body, p_category, p_data
    from unnest(v_eligible_user_ids) as uid;

  select jsonb_agg(jsonb_build_object(
    'to', pt.token, 'sound', 'default', 'title', p_title, 'body', p_body,
    'data', p_data || jsonb_build_object('category', p_category, 'group_id', p_group_id)
  ))
  into v_messages
  from push_tokens pt
  where pt.user_id = any(v_eligible_user_ids);

  if v_messages is null or jsonb_array_length(v_messages) = 0 then
    return;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object('content-type', 'application/json'),
    body := v_messages
  );
end;
$$;

-- "Fuiste removido del grupo" -> the member is no longer in that group at
-- all, so the default admin_actions/dashboard destination would be broken.
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
    array[v_member.user_id], 'Fuiste removido del grupo', 'El administrador te sacó del grupo.',
    p_group_id => v_member.group_id, p_category => 'admin_actions', p_data => jsonb_build_object('route', 'removed')
  );

  return v_member;
end;
$$;

-- Leave-related notifications all point at Rules, where "Salidas en
-- proceso" already shows who's leaving and lets them cancel.
create or replace function leave_group(p_group_id uuid, p_immediate boolean default false)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_member group_members%rowtype;
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;

  select * into v_member from group_members where group_id = p_group_id and user_id = auth.uid();
  if not found or v_member.status in ('left', 'removed') then
    raise exception 'you are not an active member of this group';
  end if;

  if p_immediate then
    if v_group.exit_fee_amount > 0 then
      insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
        values (p_group_id, auth.uid(), 'adjustment', -v_group.exit_fee_amount, 'confirmed', 'exit fee (immediate leave)', now());
    end if;
    update group_members
      set status = 'left', leave_requested_at = null, leave_effective_at = null
      where id = v_member.id
      returning * into v_member;

    perform send_push_notification(
      array[auth.uid()], 'Saliste del grupo', 'Tu salida inmediata fue procesada.',
      p_group_id => p_group_id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'leave')
    );
  else
    update group_members
      set leave_requested_at = now(), leave_effective_at = now() + (v_group.exit_notice_days || ' days')::interval
      where id = v_member.id
      returning * into v_member;

    perform send_push_notification(
      array[auth.uid()], 'Salida en proceso',
      format('Tu salida del grupo será efectiva el %s.', to_char(v_member.leave_effective_at at time zone 'America/Bogota', 'DD/MM/YYYY')),
      p_group_id => p_group_id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'leave')
    );
  end if;

  if v_group.admin_id is not null and v_group.admin_id <> auth.uid() then
    perform send_push_notification(
      array[v_group.admin_id], 'Alguien inició su salida', 'Un miembro inició su proceso de salida del grupo.',
      p_group_id => p_group_id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'leave')
    );
  end if;

  return v_member;
end;
$$;

create or replace function process_scheduled_leaves()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_user_ids uuid[];
  v_names text;
  v_admin_id uuid;
begin
  for v_group in
    select distinct group_id as id
      from group_members
      where leave_effective_at is not null and leave_effective_at <= now()
        and status not in ('left', 'removed')
  loop
    select array_agg(gm.user_id) into v_user_ids
      from group_members gm
      where gm.group_id = v_group.id
        and gm.leave_effective_at is not null and gm.leave_effective_at <= now()
        and gm.status not in ('left', 'removed');

    select string_agg(p.full_name, ', ') into v_names
      from group_members gm
      join profiles p on p.id = gm.user_id
      where gm.group_id = v_group.id
        and gm.leave_effective_at is not null and gm.leave_effective_at <= now()
        and gm.status not in ('left', 'removed');

    select admin_id into v_admin_id from groups where id = v_group.id;

    update group_members
      set status = 'left', leave_requested_at = null, leave_effective_at = null
      where group_id = v_group.id
        and leave_effective_at is not null and leave_effective_at <= now()
        and status not in ('left', 'removed');

    if v_user_ids is not null then
      perform send_push_notification(
        v_user_ids, 'Tu salida ya es efectiva', 'Tu salida del grupo se hizo efectiva hoy.',
        p_group_id => v_group.id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'leave')
      );

      if v_admin_id is not null and not (v_admin_id = any(v_user_ids)) then
        perform send_push_notification(
          array[v_admin_id], 'Un miembro salió del grupo',
          format('%s salió del grupo — su aviso de salida se hizo efectivo hoy.', v_names),
          p_group_id => v_group.id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'leave')
        );
      end if;
    end if;
  end loop;
end;
$$;

-- The admin's "new pending-deposit member" notification -> Administrar
-- Miembros, where they can confirm the deposit (with or without a receipt).
create or replace function join_group(p_invite_code text)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_member group_members%rowtype;
  v_member_existed boolean;
  v_full_name text;
begin
  select * into v_group from groups where invite_code = upper(p_invite_code);
  if not found then
    raise exception 'invalid invite code';
  end if;

  select full_name into v_full_name from profiles where id = auth.uid();

  select * into v_member from group_members
    where group_id = v_group.id and user_id = auth.uid();
  v_member_existed := found;

  if v_member_existed then
    if v_member.status in ('active', 'needs_recharge', 'pending_deposit') then
      raise exception 'already a member of this group';
    end if;
    if v_member.status = 'removed' then
      raise exception 'you were removed from this group and cannot rejoin with this code';
    end if;
    update group_members
      set status = 'pending_deposit', joined_at = now()
      where id = v_member.id
      returning * into v_member;
  else
    insert into group_members (group_id, user_id, role, status)
      values (v_group.id, auth.uid(), 'member', 'pending_deposit')
      returning * into v_member;
  end if;

  if v_group.admin_id is not null and v_group.admin_id <> auth.uid() then
    perform send_push_notification(
      array[v_group.admin_id], 'Gym Buddies',
      format('%s se unió al grupo "%s" — falta confirmar su depósito.', v_full_name, v_group.name),
      p_group_id => v_group.id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'new_member')
    );
  end if;

  return v_member;
end;
$$;

-- The admin's "new recharge pending" notification -> Confirmar Transferencias,
-- not the member-facing Wallet default for the 'money' category.
create or replace function notify_wallet_transaction_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  if new.status = 'pending' then
    select admin_id into v_admin_id from groups where id = new.group_id;
    if v_admin_id is not null then
      perform send_push_notification(
        array[v_admin_id], 'Gym Buddies', 'Hay una nueva recarga pendiente por confirmar.',
        p_group_id => new.group_id, p_category => 'money', p_data => jsonb_build_object('route', 'admin_review')
      );
    end if;
  end if;
  return new;
end;
$$;

-- The admin's "new excuse request" notification -> Revisar Excusas
-- (it hasn't been sent to a group vote yet, so Rules has nothing to show).
create or replace function create_excuse_request(
  p_group_id uuid, p_excuse_type text, p_start_date date, p_end_date date,
  p_reason text default null, p_proof_path text default null
)
returns excuse_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_admin_id uuid;
begin
  if p_excuse_type not in ('travel', 'medical', 'other') then
    raise exception 'invalid excuse type';
  end if;
  if not is_active_participant(p_group_id, auth.uid()) then
    raise exception 'only active members can request an excuse';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date must be on or after start date';
  end if;
  if p_excuse_type in ('travel', 'medical') and p_proof_path is null then
    raise exception 'travel and medical excuses require proof';
  end if;

  insert into excuse_requests (
    group_id, user_id, excuse_type, requested_start_date, requested_end_date, reason, proof_path
  ) values (
    p_group_id, auth.uid(), p_excuse_type, p_start_date, p_end_date, p_reason, p_proof_path
  ) returning * into v_request;

  select admin_id into v_admin_id from groups where id = p_group_id;
  if v_admin_id is not null then
    perform send_push_notification(
      array[v_admin_id], 'Nueva solicitud de excusa', 'Hay una solicitud de excusa pendiente por revisar.',
      p_group_id => p_group_id, p_category => 'votes', p_data => jsonb_build_object('route', 'admin_review')
    );
  end if;

  return v_request;
end;
$$;
