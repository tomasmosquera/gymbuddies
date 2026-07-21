-- ============================================================================
-- Push notifications: a generic send_push_notification() helper (via pg_net,
-- calling Expo's push API directly from Postgres) wired into every existing
-- SECURITY DEFINER RPC/trigger where a member or admin should be notified.
-- Kept entirely server-side (no Edge Functions) so every notification is
-- built from the exact numbers already computed in the triggering statement,
-- instead of re-deriving "what just happened" from a time-window guess (the
-- old supabase/functions/weekly-evaluation Edge Function did this, and is
-- superseded/removed by this migration).
-- ============================================================================
create extension if not exists pg_net;

create or replace function send_push_notification(
  p_user_ids uuid[], p_title text, p_body text, p_data jsonb default '{}'::jsonb
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
  where p.id = any(p_user_ids) and p.expo_push_token is not null;

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

-- ============================================================================
-- run_weekly_evaluation: after each member's result row is inserted, notify
-- them with the real numbers just computed (no separate query needed) — both
-- the weekly result and, if it applies, the "saldo en $0" case in the same
-- pass instead of a separate Edge Function guessing at the time window.
-- ============================================================================
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
        where group_id = v_group.id and status in ('active', 'needs_recharge')
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
      perform send_push_notification(array[v_member.user_id], 'Resultado semanal', v_message);

      if v_member.balance - v_penalty <= 0 then
        perform send_push_notification(
          array[v_member.user_id], 'Gym Buddies', 'Tu saldo llegó a $0 — recarga para seguir participando en el grupo.'
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

-- ============================================================================
-- send_checkin_reminders: nightly 6pm America/Bogota nudge (Bogota has no
-- DST, so this is a fixed 23:00 UTC cron) to any active member who hasn't
-- checked in yet today and isn't excused today. Batched into one push call.
-- ============================================================================
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
  where gm.status in ('active', 'needs_recharge')
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
    perform send_push_notification(v_user_ids, 'Gym Buddies', 'No olvides hacer tu check-in de hoy 💪');
  end if;
end;
$$;

select cron.schedule('checkin-reminder', '0 23 * * *', $$select send_checkin_reminders();$$);

-- ============================================================================
-- wallet_transactions: notify the admin the moment a recharge/deposit is
-- submitted (status='pending'), and notify the member the moment the admin
-- confirms it. Kept as two separate triggers, mirroring how trg_wallet_effect
-- and trg_wallet_stamp already split "apply the effect" from "stamp who/when".
-- ============================================================================
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
  end if;

  return new;
end;
$$;

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
        array[v_admin_id], 'Gym Buddies', 'Hay una nueva recarga pendiente por confirmar.'
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_wallet_notify_pending
  after insert on wallet_transactions
  for each row execute function notify_wallet_transaction_pending();

-- ============================================================================
-- Rule proposals: notify all voting members (except the proposer — always
-- the admin, per is_group_admin) when a new proposal opens, and notify every
-- voting member (including the admin) of the outcome, wording the "when it
-- takes effect" part from apply_immediately.
-- ============================================================================
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
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can propose rule changes';
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

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva propuesta de regla', 'El administrador propuso un cambio de reglas — ve a votar.'
    );
  end if;

  return v_proposal;
exception
  when unique_violation then
    raise exception 'this group already has an open rule vote';
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
        end
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
      perform send_push_notification(v_recipient_ids, 'Propuesta rechazada', 'La propuesta de regla fue rechazada por el grupo.');
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
          end
        );
      end if;

      if v_proposal.apply_immediately then
        perform apply_rule_proposal(v_proposal.id);
      end if;
    else
      update rule_proposals set status = 'rejected', decided_at = now() where id = v_proposal.id;

      if v_recipient_ids is not null then
        perform send_push_notification(v_recipient_ids, 'Propuesta rechazada', 'La propuesta de regla fue rechazada por el grupo.');
      end if;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- Excuse requests: admin gets pinged for travel/medical (their approval is
-- required); the group (minus the requester) gets pinged for "other" votes;
-- the requester always gets pinged with the final outcome, regardless of
-- which path resolved it (admin decision or group vote, live or timed out).
-- ============================================================================
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
        v_recipient_ids, 'Nueva votación de excusa', 'Alguien pidió una excusa por "otro motivo" — ve a votar.'
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
      perform send_push_notification(array[v_admin_id], 'Nueva solicitud de excusa', 'Hay una solicitud de excusa pendiente por aprobar.');
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

  perform send_push_notification(array[v_request.user_id], 'Tu excusa fue aprobada', 'El administrador aprobó tu solicitud de excusa.');

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

  perform send_push_notification(array[v_request.user_id], 'Tu excusa fue rechazada', 'El administrador rechazó tu solicitud de excusa.');

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
    perform send_push_notification(array[v_request.user_id], 'Tu excusa fue aprobada', 'El grupo votó a favor de tu solicitud de excusa.');
  elsif v_no > (v_request.member_count_snapshot - v_request.required_votes) then
    update excuse_requests set status = 'rejected', decided_at = now() where id = v_request_id;
    perform send_push_notification(array[v_request.user_id], 'Tu excusa fue rechazada', 'El grupo votó en contra de tu solicitud de excusa.');
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
      perform send_push_notification(array[v_request.user_id], 'Tu excusa fue aprobada', 'El grupo votó a favor de tu solicitud de excusa.');
    else
      update excuse_requests set status = 'rejected', decided_at = now() where id = v_request.id;
      perform send_push_notification(array[v_request.user_id], 'Tu excusa fue rechazada', 'El grupo votó en contra de tu solicitud de excusa.');
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- Leave/exit flow: the admin learns someone started leaving in either
-- branch; the leaving member gets a confirmation of what just happened, and
-- a final push once the notice period actually elapses.
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

    perform send_push_notification(array[auth.uid()], 'Saliste del grupo', 'Tu salida inmediata fue procesada.');
  else
    update group_members
      set leave_requested_at = now(), leave_effective_at = now() + (v_group.exit_notice_days || ' days')::interval
      where id = v_member.id
      returning * into v_member;

    perform send_push_notification(
      array[auth.uid()], 'Salida en proceso',
      format('Tu salida del grupo será efectiva el %s.', to_char(v_member.leave_effective_at at time zone 'America/Bogota', 'DD/MM/YYYY'))
    );
  end if;

  if v_group.admin_id is not null and v_group.admin_id <> auth.uid() then
    perform send_push_notification(array[v_group.admin_id], 'Alguien inició su salida', 'Un miembro inició su proceso de salida del grupo.');
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
    perform send_push_notification(v_user_ids, 'Tu salida ya es efectiva', 'Tu salida del grupo se hizo efectiva hoy.');
  end if;
end;
$$;
