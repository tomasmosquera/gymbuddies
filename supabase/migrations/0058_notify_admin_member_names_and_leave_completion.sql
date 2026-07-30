-- ============================================================================
-- Two real gaps found while investigating "who started the leave process?":
--
-- 1) leave_group's admin notification was always the generic "Alguien
--    inició su salida" / "Un miembro inició su proceso de salida del
--    grupo" — never named the member, and used the same "inició su
--    proceso" wording even for an IMMEDIATE leave (misleading, since there
--    is no "process" in that case — they already left).
--
-- 2) process_scheduled_leaves (the daily cron finalizing notice-period
--    leaves) only ever notified the LEAVING member ("Tu salida ya es
--    efectiva") — the group admin was never told a leave actually
--    completed, even though they *were* told when it started. This is why
--    "inició su salida" arrived but the matching "salió del grupo" never
--    did.
-- ============================================================================
create or replace function leave_group(p_group_id uuid, p_immediate boolean default false)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_member group_members%rowtype;
  v_full_name text;
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;

  select * into v_member from group_members where group_id = p_group_id and user_id = auth.uid();
  if not found or v_member.status in ('left', 'removed') then
    raise exception 'you are not an active member of this group';
  end if;

  select full_name into v_full_name from profiles where id = auth.uid();

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
      p_group_id => p_group_id, p_category => 'group_activity'
    );

    if v_group.admin_id is not null and v_group.admin_id <> auth.uid() then
      perform send_push_notification(
        array[v_group.admin_id], 'Un miembro salió del grupo',
        format('%s salió del grupo de inmediato.', v_full_name),
        p_group_id => p_group_id, p_category => 'group_activity'
      );
    end if;
  else
    update group_members
      set leave_requested_at = now(), leave_effective_at = now() + (v_group.exit_notice_days || ' days')::interval
      where id = v_member.id
      returning * into v_member;

    perform send_push_notification(
      array[auth.uid()], 'Salida en proceso',
      format('Tu salida del grupo será efectiva el %s.', to_char(v_member.leave_effective_at at time zone 'America/Bogota', 'DD/MM/YYYY')),
      p_group_id => p_group_id, p_category => 'group_activity'
    );

    if v_group.admin_id is not null and v_group.admin_id <> auth.uid() then
      perform send_push_notification(
        array[v_group.admin_id], 'Un miembro inició su salida',
        format(
          '%s avisó su salida — será efectiva el %s.',
          v_full_name, to_char(v_member.leave_effective_at at time zone 'America/Bogota', 'DD/MM/YYYY')
        ),
        p_group_id => p_group_id, p_category => 'group_activity'
      );
    end if;
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
        p_group_id => v_group.id, p_category => 'group_activity'
      );

      if v_admin_id is not null and not (v_admin_id = any(v_user_ids)) then
        perform send_push_notification(
          array[v_admin_id], 'Un miembro salió del grupo',
          format('%s salió del grupo — su aviso de salida se hizo efectivo hoy.', v_names),
          p_group_id => v_group.id, p_category => 'group_activity'
        );
      end if;
    end if;
  end loop;
end;
$$;
