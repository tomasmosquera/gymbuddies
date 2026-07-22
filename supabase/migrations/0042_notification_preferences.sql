-- ============================================================================
-- Lets each member choose which categories of push notifications they want,
-- from Perfil. Deliberately a single jsonb blob with broad categories (not a
-- toggle per message, and not a separate column per category) so adding a
-- new notification later never requires a schema change — it just gets
-- tagged with one of these five existing keys:
--   group_activity - teammates' photos/workouts, someone joining/leaving
--   money          - deposits, recharges, balance adjustments, penalties
--   votes          - rule proposals, excuses, photo challenges
--   reminders      - the daily "no olvides tu check-in" nudge
--   admin_actions  - the admin acting directly on your own record
-- send_push_notification is the single choke point every notification
-- already goes through, so it's the only place that needs to actually check
-- the preference — every call site just needs to say which category it is.
-- A category of NULL (the default) always sends, for anything that isn't
-- naturally one of these five.
-- ============================================================================
alter table profiles add column notification_preferences jsonb not null default '{
  "group_activity": true,
  "money": true,
  "votes": true,
  "reminders": true,
  "admin_actions": true
}'::jsonb;

create or replace function send_push_notification(
  p_user_ids uuid[], p_title text, p_body text, p_data jsonb default '{}'::jsonb, p_category text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'to', p.expo_push_token, 'sound', 'default', 'title', p_title, 'body', p_body, 'data', p_data
  ))
  into v_messages
  from profiles p
  where p.id = any(p_user_ids)
    and p.expo_push_token is not null
    and (p_category is null or coalesce((p.notification_preferences ->> p_category)::boolean, true));

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

-- ----------------------------------------------------------------------------
-- group_activity
-- ----------------------------------------------------------------------------
create or replace function submit_checkin(
  p_group_id uuid,
  p_captured_at timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_location_accuracy_m double precision,
  p_photo_path text
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_checkin_date date := (p_captured_at at time zone 'America/Bogota')::date;
  v_is_first_today boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can check in';
  end if;

  select not exists (
    select 1 from checkins
    where group_id = p_group_id and user_id = auth.uid() and checkin_date = v_checkin_date
  ) into v_is_first_today;

  insert into checkins (group_id, user_id, captured_at, latitude, longitude, location_accuracy_m, photo_path)
    values (p_group_id, auth.uid(), p_captured_at, p_latitude, p_longitude, p_location_accuracy_m, p_photo_path)
    on conflict (group_id, user_id, checkin_date) do update set
      captured_at = excluded.captured_at,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      location_accuracy_m = excluded.location_accuracy_m,
      photo_path = excluded.photo_path
    returning * into v_checkin;

  if v_is_first_today then
    select * into v_group from groups where id = p_group_id;
    if not v_group.require_checkout_photo then
      select full_name into v_full_name from profiles where id = auth.uid();
      select array_agg(user_id) into v_recipient_ids
        from group_members
        where group_id = p_group_id
          and status in ('pending_deposit', 'active', 'needs_recharge')
          and user_id <> auth.uid();
      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Gym Buddies', format('%s ha subido una foto de su entreno.', v_full_name),
          p_category => 'group_activity'
        );
      end if;
    end if;
  end if;

  return v_checkin;
end;
$$;

create or replace function submit_workout_checkout(
  p_checkin_id uuid,
  p_captured_at timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_location_accuracy_m double precision,
  p_photo_path text
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_is_first_checkout boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;
  if v_checkin.checkin_date <> (now() at time zone 'America/Bogota')::date then
    raise exception 'checkout can only be submitted the same day as the check-in';
  end if;
  if abs(extract(epoch from (now() - p_captured_at))) > 14400 then
    raise exception 'captured_at is too far from server time (clock drift guard)';
  end if;
  if p_captured_at <= v_checkin.captured_at then
    raise exception 'checkout must be after the initial check-in';
  end if;

  v_is_first_checkout := v_checkin.checkout_captured_at is null;

  update checkins
    set checkout_captured_at = p_captured_at,
        checkout_latitude = p_latitude,
        checkout_longitude = p_longitude,
        checkout_location_accuracy_m = p_location_accuracy_m,
        checkout_photo_path = p_photo_path,
        workout_minutes = greatest(round(extract(epoch from (p_captured_at - v_checkin.captured_at)) / 60)::int, 0)
    where id = p_checkin_id
    returning * into v_checkin;

  if v_is_first_checkout then
    select * into v_group from groups where id = v_checkin.group_id;
    if v_group.require_checkout_photo then
      select full_name into v_full_name from profiles where id = auth.uid();
      select array_agg(user_id) into v_recipient_ids
        from group_members
        where group_id = v_checkin.group_id
          and status in ('pending_deposit', 'active', 'needs_recharge')
          and user_id <> auth.uid();
      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Gym Buddies', format('%s ha terminado su entreno de hoy.', v_full_name),
          p_category => 'group_activity'
        );
      end if;
    end if;
  end if;

  return v_checkin;
end;
$$;

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
      p_category => 'group_activity'
    );
  end if;

  return v_member;
end;
$$;

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
      array[auth.uid()], 'Saliste del grupo', 'Tu salida inmediata fue procesada.', p_category => 'group_activity'
    );
  else
    update group_members
      set leave_requested_at = now(), leave_effective_at = now() + (v_group.exit_notice_days || ' days')::interval
      where id = v_member.id
      returning * into v_member;

    perform send_push_notification(
      array[auth.uid()], 'Salida en proceso',
      format('Tu salida del grupo será efectiva el %s.', to_char(v_member.leave_effective_at at time zone 'America/Bogota', 'DD/MM/YYYY')),
      p_category => 'group_activity'
    );
  end if;

  if v_group.admin_id is not null and v_group.admin_id <> auth.uid() then
    perform send_push_notification(
      array[v_group.admin_id], 'Alguien inició su salida', 'Un miembro inició su proceso de salida del grupo.',
      p_category => 'group_activity'
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
  v_user_ids uuid[];
begin
  select array_agg(user_id) into v_user_ids
    from group_members
    where leave_effective_at is not null and leave_effective_at <= now()
      and status not in ('left', 'removed');

  update group_members
    set status = 'left', leave_requested_at = null, leave_effective_at = null
    where leave_effective_at is not null and leave_effective_at <= now()
      and status not in ('left', 'removed');

  if v_user_ids is not null then
    perform send_push_notification(
      v_user_ids, 'Tu salida ya es efectiva', 'Tu salida del grupo se hizo efectiva hoy.', p_category => 'group_activity'
    );
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- money
-- ----------------------------------------------------------------------------
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
        array[v_admin_id], 'Gym Buddies', 'Hay una nueva recarga pendiente por confirmar.', p_category => 'money'
      );
    end if;
  end if;
  return new;
end;
$$;

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
      array[new.user_id], 'Gym Buddies', 'Tu recarga fue confirmada por el administrador.', p_category => 'money'
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'rejected'
     and new.type in ('recharge', 'initial_deposit') then
    perform send_push_notification(
      array[new.user_id], 'Gym Buddies', 'Tu recarga fue rechazada por el administrador. Revisa el comprobante y vuelve a intentarlo.',
      p_category => 'money'
    );
  end if;

  return new;
end;
$$;

create or replace function admin_adjust_balance(
  p_group_id uuid, p_user_id uuid, p_amount numeric, p_note text default null
)
returns wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx wallet_transactions%rowtype;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can adjust a member''s balance';
  end if;
  if p_amount = 0 then
    raise exception 'the adjustment amount cannot be zero';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'user is not a member of this group';
  end if;

  insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_by, confirmed_at)
    values (p_group_id, p_user_id, 'adjustment', p_amount, 'confirmed', p_note, auth.uid(), now())
    returning * into v_tx;

  perform send_push_notification(
    array[p_user_id], 'Tu saldo fue ajustado',
    format(
      'El administrador %s tu saldo en %s %s.',
      case when p_amount > 0 then 'aumentó' else 'disminuyó' end,
      (select currency from groups where id = p_group_id),
      to_char(abs(p_amount), 'FM999,999,999')
    ),
    p_category => 'money'
  );

  return v_tx;
end;
$$;

create or replace function admin_delete_wallet_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx wallet_transactions%rowtype;
begin
  select * into v_tx from wallet_transactions where id = p_transaction_id;
  if not found then
    raise exception 'transaction not found';
  end if;
  if not is_group_admin(v_tx.group_id) then
    raise exception 'only the group admin can delete transactions';
  end if;
  if v_tx.status <> 'pending' then
    raise exception 'only pending transactions can be deleted';
  end if;

  if v_tx.receipt_path is not null then
    delete from storage.objects where bucket_id = 'receipts' and name = v_tx.receipt_path;
  end if;
  delete from wallet_transactions where id = p_transaction_id;

  perform send_push_notification(
    array[v_tx.user_id], 'Tu comprobante fue eliminado',
    'El administrador eliminó tu comprobante pendiente. Si fue un error, puedes volver a enviarlo.',
    p_category => 'money'
  );
end;
$$;

create or replace function run_weekly_evaluation()
returns setof weekly_evaluation_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_end date := (now() at time zone 'America/Bogota')::date - 1;
  v_week_start date := v_week_end - 6;
  v_group record;
  v_member record;
  v_run_id uuid;
  v_completed int;
  v_excused int;
  v_activated_date date;
  v_days_present int;
  v_required int;
  v_effective_required int;
  v_failed int;
  v_penalty numeric(12, 2);
  v_result_id uuid;
  v_run_ids uuid[] := '{}';
  v_due_proposal_id uuid;
  v_message text;
begin
  for v_group in select * from groups loop
    begin
      insert into weekly_evaluation_runs (group_id, week_start_date, week_end_date)
        values (v_group.id, v_week_start, v_week_end)
        returning id into v_run_id;
    exception
      when unique_violation then
        continue;
    end;
    v_run_ids := v_run_ids || v_run_id;

    for v_member in
      select * from group_members
        where group_id = v_group.id and status in ('pending_deposit', 'active', 'needs_recharge')
    loop
      select count(distinct d.the_date) into v_completed
        from (
          select checkin_date as the_date from checkins
            where group_id = v_group.id and user_id = v_member.user_id
              and checkin_date between v_week_start and v_week_end
          union
          select override_date as the_date from attendance_overrides
            where group_id = v_group.id and user_id = v_member.user_id and status = 'valid'
              and override_date between v_week_start and v_week_end
        ) d
        where not exists (
          select 1 from attendance_overrides fo
            where fo.group_id = v_group.id and fo.user_id = v_member.user_id and fo.status = 'failed'
              and fo.override_date = d.the_date
        );

      select count(*) into v_excused
        from excuse_dates
        where group_id = v_group.id and user_id = v_member.user_id
          and excused_date between v_week_start and v_week_end;

      v_activated_date := (coalesce(v_member.activated_at, v_member.joined_at) at time zone 'America/Bogota')::date;
      v_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_activated_date)) + 1));

      v_required := least(v_group.min_days_per_week, v_days_present);
      v_effective_required := greatest(v_required - v_excused, 0);
      v_failed := greatest(v_effective_required - v_completed, 0);
      v_penalty := least(v_failed * v_group.penalty_amount, v_group.weekly_penalty_cap);

      insert into weekly_evaluation_results (
        run_id, group_id, user_id, required_days, completed_days,
        excused_days_used, failed_days, penalty_charged,
        balance_before, balance_after, status_after
      ) values (
        v_run_id, v_group.id, v_member.user_id, v_required, v_completed,
        v_excused, v_failed, v_penalty, v_member.balance,
        v_member.balance - v_penalty,
        case when v_member.balance - v_penalty <= 0 then 'needs_recharge' else 'active' end
      ) returning id into v_result_id;

      if v_failed = 0 then
        v_message := format('¡Cumpliste tu meta esta semana! Entrenaste %s de %s días requeridos.', v_completed, v_required);
      else
        v_message := format(
          'Esta semana entrenaste %s de %s días requeridos (%s fallado(s)). Penalización: %s %s.',
          v_completed, v_required, v_failed, v_group.currency, to_char(v_penalty, 'FM999,999,999')
        );
      end if;
      perform send_push_notification(array[v_member.user_id], 'Resultado semanal', v_message, p_category => 'money');

      if v_member.balance - v_penalty <= 0 then
        perform send_push_notification(
          array[v_member.user_id], 'Gym Buddies', 'Tu saldo llegó a $0 — recarga para seguir participando en el grupo.',
          p_category => 'money'
        );
      end if;

      if v_penalty > 0 then
        insert into wallet_transactions (
          group_id, user_id, type, amount, status, weekly_evaluation_result_id, confirmed_at
        ) values (
          v_group.id, v_member.user_id, 'penalty', -v_penalty, 'confirmed', v_result_id, now()
        );
      end if;
    end loop;

    select id into v_due_proposal_id
      from rule_proposals
      where group_id = v_group.id and status = 'approved' and applied_at is null and effective_at <= now()
      order by effective_at asc, decided_at asc limit 1;

    if v_due_proposal_id is not null then
      perform apply_rule_proposal(v_due_proposal_id);
    end if;
  end loop;

  return query select * from weekly_evaluation_runs where id = any(v_run_ids);
end;
$$;

-- ----------------------------------------------------------------------------
-- reminders
-- ----------------------------------------------------------------------------
create or replace function send_checkin_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_user_ids uuid[];
begin
  select array_agg(distinct gm.user_id) into v_user_ids
  from group_members gm
  where gm.status in ('pending_deposit', 'active', 'needs_recharge')
    and (coalesce(gm.activated_at, gm.joined_at) at time zone 'America/Bogota')::date <= v_today
    and not exists (
      select 1 from checkins c
      where c.group_id = gm.group_id and c.user_id = gm.user_id and c.checkin_date = v_today
    )
    and not exists (
      select 1 from excuse_dates ed
      where ed.group_id = gm.group_id and ed.user_id = gm.user_id and ed.excused_date = v_today
    );

  if v_user_ids is not null then
    perform send_push_notification(
      v_user_ids, 'Gym Buddies', 'No olvides hacer tu check-in de hoy 💪', p_category => 'reminders'
    );
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_actions
-- ----------------------------------------------------------------------------
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
    ),
    p_category => 'admin_actions'
  );

  return v_override;
end;
$$;

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
    format('El administrador eliminó tu check-in del %s.', to_char(v_checkin.checkin_date, 'DD/MM/YYYY')),
    p_category => 'admin_actions'
  );
end;
$$;

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
    p_category => 'admin_actions'
  );

  return v_member;
end;
$$;

create or replace function admin_set_member_activation_date(p_member_id uuid, p_date date)
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
    raise exception 'only the group admin can change a member''s activation date';
  end if;

  update group_members
    set activated_at = (p_date::timestamp) at time zone 'America/Bogota'
    where id = p_member_id
    returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Tu fecha de entrada cambió',
    format('El administrador ajustó la fecha desde la que cuentan tus días a partir del %s.', to_char(p_date, 'DD/MM/YYYY')),
    p_category => 'admin_actions'
  );

  return v_member;
end;
$$;

-- ----------------------------------------------------------------------------
-- votes
-- ----------------------------------------------------------------------------
create or replace function propose_rule_change(
  p_group_id uuid,
  p_changes jsonb,
  p_apply_immediately boolean default false
)
returns rule_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count int;
  v_proposal rule_proposals%rowtype;
  v_recipient_ids uuid[];
  v_full_name text;
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can propose rule changes';
  end if;

  select count(*) into v_member_count
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge');

  if v_member_count < 1 then
    raise exception 'no active members to vote yet';
  end if;

  insert into rule_proposals (
    group_id, proposed_by, proposed_changes, required_votes,
    member_count_snapshot, voting_closes_at, apply_immediately
  ) values (
    p_group_id, auth.uid(), p_changes, floor(v_member_count / 2.0)::int + 1,
    v_member_count, now() + interval '72 hours', p_apply_immediately
  ) returning * into v_proposal;

  select full_name into v_full_name from profiles where id = auth.uid();

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva propuesta de regla', format('%s propuso un cambio de reglas — ve a votar.', v_full_name),
      p_category => 'votes'
    );
  end if;

  return v_proposal;
exception
  when unique_violation then
    raise exception 'this group already has an open rule vote';
end;
$$;

create or replace function apply_rule_change_direct(p_group_id uuid, p_changes jsonb)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_recipient_ids uuid[];
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can apply rule changes directly';
  end if;

  update groups g
    set min_days_per_week = coalesce((p_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
        penalty_amount = coalesce((p_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
        weekly_penalty_cap = coalesce((p_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
        exit_fee_amount = coalesce((p_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
        exit_notice_days = coalesce((p_changes ->> 'exit_notice_days')::int, g.exit_notice_days),
        require_checkout_photo = coalesce((p_changes ->> 'require_checkout_photo')::boolean, g.require_checkout_photo),
        min_workout_minutes = coalesce((p_changes ->> 'min_workout_minutes')::int, g.min_workout_minutes)
    where g.id = p_group_id
    returning * into v_group;

  if not found then
    raise exception 'group not found';
  end if;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Reglas actualizadas',
      'El administrador actualizó las reglas del grupo directamente, sin necesidad de votación.',
      p_category => 'votes'
    );
  end if;

  return v_group;
end;
$$;

create or replace function resolve_rule_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal rule_proposals%rowtype;
  v_yes int;
  v_no int;
  v_proposal_id uuid := coalesce(new.proposal_id, old.proposal_id);
  v_recipient_ids uuid[];
begin
  select * into v_proposal from rule_proposals where id = v_proposal_id for update;
  if v_proposal.status <> 'pending' then
    return null;
  end if;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from rule_votes where proposal_id = v_proposal_id;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = v_proposal.group_id and status in ('active', 'needs_recharge');

  if v_yes >= v_proposal.required_votes then
    update rule_proposals
      set status = 'approved',
          decided_at = now(),
          effective_at = case
            when v_proposal.apply_immediately then now()
            else (
              (date_trunc('week', (now() at time zone 'America/Bogota')) + interval '1 week')
                at time zone 'America/Bogota'
            )
          end
      where id = v_proposal_id;

    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Propuesta aprobada',
        case when v_proposal.apply_immediately
          then 'La propuesta de regla fue aprobada y ya está vigente.'
          else 'La propuesta de regla fue aprobada — aplica desde el próximo lunes.'
        end,
        p_category => 'votes'
      );
    end if;

    if v_proposal.apply_immediately then
      perform apply_rule_proposal(v_proposal_id);
    end if;
  elsif v_no > (v_proposal.member_count_snapshot - v_proposal.required_votes) then
    update rule_proposals
      set status = 'rejected', decided_at = now()
      where id = v_proposal_id;

    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Propuesta rechazada', 'La propuesta de regla fue rechazada por el grupo.', p_category => 'votes'
      );
    end if;
  end if;

  return null;
end;
$$;

create or replace function close_expired_proposals()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal record;
  v_yes int;
  v_recipient_ids uuid[];
begin
  for v_proposal in
    select * from rule_proposals
      where status = 'pending' and voting_closes_at <= now()
      for update
  loop
    select count(*) filter (where vote = 'yes') into v_yes
      from rule_votes where proposal_id = v_proposal.id;

    select array_agg(user_id) into v_recipient_ids
      from group_members
      where group_id = v_proposal.group_id and status in ('active', 'needs_recharge');

    if v_yes >= v_proposal.required_votes then
      update rule_proposals
        set status = 'approved',
            decided_at = now(),
            effective_at = case
              when v_proposal.apply_immediately then now()
              else (
                (date_trunc('week', (now() at time zone 'America/Bogota')) + interval '1 week')
                  at time zone 'America/Bogota'
              )
            end
        where id = v_proposal.id;

      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Propuesta aprobada',
          case when v_proposal.apply_immediately
            then 'La propuesta de regla fue aprobada y ya está vigente.'
            else 'La propuesta de regla fue aprobada — aplica desde el próximo lunes.'
          end,
          p_category => 'votes'
        );
      end if;

      if v_proposal.apply_immediately then
        perform apply_rule_proposal(v_proposal.id);
      end if;
    else
      update rule_proposals set status = 'rejected', decided_at = now() where id = v_proposal.id;

      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Propuesta rechazada', 'La propuesta de regla fue rechazada por el grupo.', p_category => 'votes'
        );
      end if;
    end if;
  end loop;
end;
$$;

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
        v_recipient_ids, 'Votación cancelada', 'El administrador canceló la propuesta de cambio de reglas en curso.',
        p_category => 'votes'
      );
    end if;
  end if;
  return new;
end;
$$;

create or replace function create_excuse_request(
  p_group_id uuid,
  p_excuse_type text,
  p_start_date date,
  p_end_date date,
  p_reason text default null,
  p_proof_path text default null
)
returns excuse_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_member_count int;
  v_admin_id uuid;
  v_recipient_ids uuid[];
begin
  if p_excuse_type not in ('travel', 'medical', 'other') then
    raise exception 'invalid excuse type';
  end if;
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can request an excuse';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date must be on or after start date';
  end if;
  if p_excuse_type in ('travel', 'medical') and p_proof_path is null then
    raise exception 'travel and medical excuses require proof';
  end if;

  if p_excuse_type = 'other' then
    select count(*) into v_member_count
      from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
    if v_member_count < 1 then
      raise exception 'no active members to vote yet';
    end if;

    insert into excuse_requests (
      group_id, user_id, excuse_type, requested_start_date, requested_end_date,
      reason, proof_path, required_votes, member_count_snapshot, voting_closes_at
    ) values (
      p_group_id, auth.uid(), p_excuse_type, p_start_date, p_end_date,
      p_reason, p_proof_path, floor(v_member_count / 2.0)::int + 1, v_member_count, now() + interval '72 hours'
    ) returning * into v_request;

    select array_agg(user_id) into v_recipient_ids
      from group_members
      where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Nueva votación de excusa', 'Alguien pidió una excusa por "otro motivo" — ve a votar.',
        p_category => 'votes'
      );
    end if;
  else
    insert into excuse_requests (
      group_id, user_id, excuse_type, requested_start_date, requested_end_date, reason, proof_path
    ) values (
      p_group_id, auth.uid(), p_excuse_type, p_start_date, p_end_date, p_reason, p_proof_path
    ) returning * into v_request;

    select admin_id into v_admin_id from groups where id = p_group_id;
    if v_admin_id is not null then
      perform send_push_notification(
        array[v_admin_id], 'Nueva solicitud de excusa', 'Hay una solicitud de excusa pendiente por aprobar.',
        p_category => 'votes'
      );
    end if;
  end if;

  return v_request;
exception
  when unique_violation then
    raise exception 'this group already has an open "other" excuse vote';
end;
$$;

create or replace function approve_excuse_request(p_request_id uuid, p_excused_dates date[])
returns excuse_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_date date;
begin
  select * into v_request from excuse_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'this request is not open';
  end if;
  if v_request.excuse_type = 'other' then
    raise exception 'other-type excuses are resolved by group vote, not admin approval';
  end if;
  if not is_group_admin(v_request.group_id) then
    raise exception 'only the group admin can approve this request';
  end if;
  if p_excused_dates is null or array_length(p_excused_dates, 1) is null then
    raise exception 'select at least one date to excuse';
  end if;

  foreach v_date in array p_excused_dates loop
    if v_date < v_request.requested_start_date or v_date > v_request.requested_end_date then
      raise exception 'excused date % is outside the requested range', v_date;
    end if;
  end loop;

  update excuse_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now()
    where id = p_request_id;

  insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
    select p_request_id, v_request.group_id, v_request.user_id, d
    from unnest(p_excused_dates) as d
  on conflict (group_id, user_id, excused_date) do nothing;

  perform send_push_notification(
    array[v_request.user_id], 'Tu excusa fue aprobada', 'El administrador aprobó tu solicitud de excusa.',
    p_category => 'votes'
  );

  select * into v_request from excuse_requests where id = p_request_id;
  return v_request;
end;
$$;

create or replace function reject_excuse_request(p_request_id uuid, p_decision_note text default null)
returns excuse_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
begin
  select * into v_request from excuse_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'this request is not open';
  end if;
  if v_request.excuse_type = 'other' then
    raise exception 'other-type excuses are resolved by group vote, not admin rejection';
  end if;
  if not is_group_admin(v_request.group_id) then
    raise exception 'only the group admin can reject this request';
  end if;

  update excuse_requests
    set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_decision_note
    where id = p_request_id
    returning * into v_request;

  perform send_push_notification(
    array[v_request.user_id], 'Tu excusa fue rechazada', 'El administrador rechazó tu solicitud de excusa.',
    p_category => 'votes'
  );

  return v_request;
end;
$$;

create or replace function resolve_excuse_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_yes int;
  v_no int;
  v_request_id uuid := coalesce(new.excuse_request_id, old.excuse_request_id);
begin
  select * into v_request from excuse_requests where id = v_request_id for update;
  if v_request.status <> 'pending' then
    return null;
  end if;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from excuse_votes where excuse_request_id = v_request_id;

  if v_yes >= v_request.required_votes then
    update excuse_requests set status = 'approved', decided_at = now() where id = v_request_id;
    insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
      select v_request_id, v_request.group_id, v_request.user_id, d::date
      from generate_series(v_request.requested_start_date, v_request.requested_end_date, interval '1 day') as d
    on conflict (group_id, user_id, excused_date) do nothing;
    perform send_push_notification(
      array[v_request.user_id], 'Tu excusa fue aprobada', 'El grupo votó a favor de tu solicitud de excusa.',
      p_category => 'votes'
    );
  elsif v_no > (v_request.member_count_snapshot - v_request.required_votes) then
    update excuse_requests set status = 'rejected', decided_at = now() where id = v_request_id;
    perform send_push_notification(
      array[v_request.user_id], 'Tu excusa fue rechazada', 'El grupo votó en contra de tu solicitud de excusa.',
      p_category => 'votes'
    );
  end if;

  return null;
end;
$$;

create or replace function close_expired_excuse_votes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_yes int;
begin
  for v_request in
    select * from excuse_requests
      where status = 'pending' and excuse_type = 'other' and voting_closes_at <= now()
      for update
  loop
    select count(*) filter (where vote = 'yes') into v_yes
      from excuse_votes where excuse_request_id = v_request.id;

    if v_yes >= v_request.required_votes then
      update excuse_requests set status = 'approved', decided_at = now() where id = v_request.id;
      insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
        select v_request.id, v_request.group_id, v_request.user_id, d::date
        from generate_series(v_request.requested_start_date, v_request.requested_end_date, interval '1 day') as d
      on conflict (group_id, user_id, excused_date) do nothing;
      perform send_push_notification(
        array[v_request.user_id], 'Tu excusa fue aprobada', 'El grupo votó a favor de tu solicitud de excusa.',
        p_category => 'votes'
      );
    else
      update excuse_requests set status = 'rejected', decided_at = now() where id = v_request.id;
      perform send_push_notification(
        array[v_request.user_id], 'Tu excusa fue rechazada', 'El grupo votó en contra de tu solicitud de excusa.',
        p_category => 'votes'
      );
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- Photo challenges also now name whoever started the vote (both in the push
-- copy and, via challenger full_name being selectable client-side, in the
-- app itself) instead of the anonymous "alguien"/"un miembro del grupo".
-- ============================================================================
create or replace function create_photo_challenge(p_checkin_id uuid, p_reason text default null)
returns photo_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_member_count int;
  v_challenge photo_challenges%rowtype;
  v_recipient_ids uuid[];
  v_full_name text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to challenge a photo';
  end if;
  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_voting_member(v_checkin.group_id, auth.uid()) then
    raise exception 'only active members can challenge a photo';
  end if;
  if v_checkin.user_id = auth.uid() then
    raise exception 'you cannot challenge your own photo';
  end if;

  select count(*) into v_member_count
    from group_members
    where group_id = v_checkin.group_id and status in ('active', 'needs_recharge') and user_id <> v_checkin.user_id;
  if v_member_count < 1 then
    raise exception 'no eligible members to vote yet';
  end if;

  insert into photo_challenges (
    group_id, checkin_id, target_user_id, challenged_by, reason, required_votes, member_count_snapshot, voting_closes_at
  ) values (
    v_checkin.group_id, p_checkin_id, v_checkin.user_id, auth.uid(), btrim(p_reason),
    floor(v_member_count / 2.0)::int + 1, v_member_count, now() + interval '72 hours'
  ) returning * into v_challenge;

  select full_name into v_full_name from profiles where id = auth.uid();

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = v_checkin.group_id and status in ('active', 'needs_recharge')
      and user_id <> auth.uid() and user_id <> v_checkin.user_id;
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva votación de foto', format('%s pidió invalidar la foto de un check-in — ve a votar.', v_full_name),
      p_category => 'votes'
    );
  end if;

  perform send_push_notification(
    array[v_checkin.user_id], 'Tu foto está en votación',
    format('%s pidió invalidar tu check-in. El grupo va a votar si es válido.', v_full_name),
    p_category => 'votes'
  );

  return v_challenge;
exception
  when unique_violation then
    raise exception 'este check-in ya tiene una votación abierta';
end;
$$;

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
      'El grupo votó que tu check-in no era válido — ese día ahora cuenta como fallado.',
      p_category => 'votes'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue aceptada', 'El grupo votó a favor de invalidar el check-in que retaste.',
      p_category => 'votes'
    );
  elsif v_no > (v_challenge.member_count_snapshot - v_challenge.required_votes) then
    update photo_challenges set status = 'valid', decided_at = now() where id = v_challenge_id;
    perform send_push_notification(
      array[v_challenge.target_user_id], 'Tu foto fue validada', 'El grupo votó que tu check-in sí es válido.',
      p_category => 'votes'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue rechazada', 'El grupo votó que el check-in que retaste sí es válido.',
      p_category => 'votes'
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
      array[v_challenge.target_user_id], 'Tu foto fue validada', 'El administrador decidió que tu check-in sí es válido.',
      p_category => 'votes'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue rechazada', 'El administrador decidió que el check-in que retaste sí es válido.',
      p_category => 'votes'
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
      'El administrador decidió que tu check-in no era válido — ese día ahora cuenta como fallado.',
      p_category => 'votes'
    );
    perform send_push_notification(
      array[v_challenge.challenged_by], 'Tu votación fue aceptada', 'El administrador invalidó el check-in que retaste.',
      p_category => 'votes'
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
        'El grupo votó que tu check-in no era válido — ese día ahora cuenta como fallado.',
        p_category => 'votes'
      );
      perform send_push_notification(
        array[v_challenge.challenged_by], 'Tu votación fue aceptada', 'El grupo votó a favor de invalidar el check-in que retaste.',
        p_category => 'votes'
      );
    else
      update photo_challenges set status = 'valid', decided_at = now() where id = v_challenge.id;
      perform send_push_notification(
        array[v_challenge.target_user_id], 'Tu foto fue validada', 'El grupo votó que tu check-in sí es válido.',
        p_category => 'votes'
      );
      perform send_push_notification(
        array[v_challenge.challenged_by], 'Tu votación fue rechazada', 'El grupo votó que el check-in que retaste sí es válido.',
        p_category => 'votes'
      );
    end if;
  end loop;
end;
$$;
