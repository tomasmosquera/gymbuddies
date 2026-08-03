-- ============================================================================
-- Fase A del soporte de timezone por grupo. groups.timezone ha existido desde
-- 0002 (default 'America/Bogota') pero ninguna función lo leía — todo el
-- backend tenía 'America/Bogota' cableado a mano. Esta migración redefine
-- cada función vigente que derivaba un día/semana calendario para que use
-- groups.timezone en su lugar. Postgres trae la base de datos IANA completa
-- (con DST correcto donde aplique), así que `at time zone g.timezone` con
-- cualquier zona real funciona de una sin trabajo adicional.
--
-- Deliberadamente fuera de alcance: cleanup_old_checkin_photos() (0057) sigue
-- usando 'America/Bogota' para decidir cuándo purgar fotos viejas — es un
-- barrido de housekeeping/privacidad, no algo de lo que dependa la equidad
-- del juego; unas horas de diferencia entre zonas no importan ahí, y
-- reescribirlo para unir cada fila con su grupo triplicaría esa consulta sin
-- beneficio real.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Valida el timezone contra la base de datos IANA de Postgres en cada
-- insert/update — protege tanto a create_group() como a cualquier UPDATE
-- directo de admin (ej. admin-edit-group.tsx), sin importar el camino.
-- ----------------------------------------------------------------------------
create or replace function validate_group_timezone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'invalid timezone: %', new.timezone;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_group_timezone on groups;
create trigger trg_validate_group_timezone
  before insert or update of timezone on groups
  for each row execute function validate_group_timezone();

-- ----------------------------------------------------------------------------
-- set_checkin_date(): checkin_date ahora se deriva con el timezone del grupo
-- del check-in, no con Bogotá fijo.
-- ----------------------------------------------------------------------------
create or replace function set_checkin_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  select timezone into v_tz from groups where id = new.group_id;
  if tg_op = 'INSERT' or new.captured_at is distinct from old.captured_at then
    if abs(extract(epoch from (now() - new.captured_at))) > 14400 then
      raise exception 'captured_at is too far from server time (clock drift guard)';
    end if;
  end if;
  new.checkin_date := (new.captured_at at time zone v_tz)::date;
  if tg_op = 'UPDATE' and new.checkin_date <> old.checkin_date then
    raise exception 'a check-in cannot be moved to a different day; take a new one instead';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- submit_checkin() / submit_workout_checkout(): mismo cambio, sobre la
-- versión más reciente (0066, que ya agregó el rechazo de ubicación
-- simulada) — solo se toca la derivación de fecha/día, todo lo demás igual.
-- ----------------------------------------------------------------------------
create or replace function submit_checkin(
  p_group_id uuid, p_captured_at timestamptz, p_latitude double precision,
  p_longitude double precision, p_location_accuracy_m double precision, p_photo_path text,
  p_location_mocked boolean default false
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_tz text;
  v_checkin_date date;
  v_is_first_today boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can check in';
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;

  select * into v_group from groups where id = p_group_id;
  v_tz := v_group.timezone;
  v_checkin_date := (p_captured_at at time zone v_tz)::date;

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
          p_group_id => p_group_id, p_category => 'group_activity'
        );
      end if;
    end if;
  end if;

  return v_checkin;
end;
$$;

create or replace function submit_workout_checkout(
  p_checkin_id uuid, p_captured_at timestamptz, p_latitude double precision,
  p_longitude double precision, p_location_accuracy_m double precision, p_photo_path text,
  p_location_mocked boolean default false
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_tz text;
  v_is_first_checkout boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;

  select timezone into v_tz from groups where id = v_checkin.group_id;
  if v_checkin.checkin_date <> (now() at time zone v_tz)::date then
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
          p_group_id => v_checkin.group_id, p_category => 'group_activity'
        );
      end if;
    end if;
  end if;

  return v_checkin;
end;
$$;

-- ----------------------------------------------------------------------------
-- run_weekly_evaluation(): v_week_start/v_week_end ahora se calculan por
-- grupo, dentro del loop, con v_group.timezone — antes se calculaban una
-- sola vez para todos los grupos usando Bogotá. La idempotencia ya existente
-- (unique_violation -> continue en el insert de weekly_evaluation_runs) es
-- justo lo que permite subir la frecuencia del cron sin duplicar semanas —
-- ver el cron.alter_job más abajo.
-- ----------------------------------------------------------------------------
create or replace function run_weekly_evaluation()
returns setof weekly_evaluation_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_end date;
  v_week_start date;
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
  v_penalty_start_date date;
  v_penalty_days_present int;
  v_penalty_required int;
  v_effective_penalty_required int;
  v_failed_for_penalty int;
  v_penalty_protected boolean;
  v_penalty numeric(12, 2);
  v_result_id uuid;
  v_run_ids uuid[] := '{}';
  v_due_proposal_id uuid;
  v_message text;
begin
  for v_group in select * from groups loop
    v_week_end := (now() at time zone v_group.timezone)::date - 1;
    v_week_start := v_week_end - 6;

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
      v_activated_date := (coalesce(v_member.activated_at, v_member.joined_at) at time zone v_group.timezone)::date;
      v_penalty_start_date := (
        coalesce(v_member.penalty_start_date, v_member.activated_at, v_member.joined_at) at time zone v_group.timezone
      )::date;

      select count(distinct d.the_date) into v_completed
        from (
          select checkin_date as the_date from checkins
            where group_id = v_group.id and user_id = v_member.user_id
              and checkin_date between v_week_start and v_week_end
              and checkin_date >= v_activated_date
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

      v_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_activated_date)) + 1));
      v_required := least(v_group.min_days_per_week, v_days_present);
      v_effective_required := greatest(v_required - v_excused, 0);
      v_failed := greatest(v_effective_required - v_completed, 0);

      v_penalty_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_penalty_start_date)) + 1));
      v_penalty_required := least(v_group.min_days_per_week, v_penalty_days_present);
      v_effective_penalty_required := greatest(v_penalty_required - v_excused, 0);
      v_failed_for_penalty := greatest(v_effective_penalty_required - v_completed, 0);
      v_penalty_protected := v_penalty_start_date > v_week_start;

      v_penalty := case
        when v_group.payout_mode = 'league' then 0
        else least(v_failed_for_penalty * v_group.penalty_amount, v_group.weekly_penalty_cap)
      end;

      insert into weekly_evaluation_results (
        run_id, group_id, user_id, required_days, completed_days,
        excused_days_used, failed_days, penalty_charged, penalty_protected,
        balance_before, balance_after, status_after
      ) values (
        v_run_id, v_group.id, v_member.user_id, v_required, v_completed,
        v_excused, v_failed, v_penalty, v_penalty_protected, v_member.balance,
        v_member.balance - v_penalty,
        case when v_member.balance - v_penalty <= 0 then 'needs_recharge' else 'active' end
      ) returning id into v_result_id;

      if v_group.payout_mode = 'league' then
        v_message := format(
          'Semana registrada: %s de %s días entrenados. En modo Liga no hay multas — solo cuenta tu puesto en el ranking al final del ciclo.',
          v_completed, v_required
        );
      elsif v_failed = 0 then
        v_message := format('¡Cumpliste tu meta esta semana! Entrenaste %s de %s días requeridos.', v_completed, v_required);
      elsif v_penalty = 0 and v_penalty_protected then
        v_message := format(
          'Esta semana entrenaste %s de %s días requeridos (%s fallado(s)), pero tu periodo de gracia sigue activo — sin penalización.',
          v_completed, v_required, v_failed
        );
      else
        v_message := format(
          'Esta semana entrenaste %s de %s días requeridos (%s fallado(s)). Penalización: %s %s.',
          v_completed, v_required, v_failed, v_group.currency, to_char(v_penalty, 'FM999,999,999')
        );
      end if;
      perform send_push_notification(
        array[v_member.user_id], 'Resultado semanal', v_message,
        p_group_id => v_group.id, p_category => 'money'
      );

      if v_member.balance - v_penalty <= 0 then
        perform send_push_notification(
          array[v_member.user_id], 'Gym Buddies', 'Tu saldo llegó a $0 — recarga para seguir participando en el grupo.',
          p_group_id => v_group.id, p_category => 'money'
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

    perform evaluate_due_league_cycle(v_group.id, v_week_end);

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
-- send_checkin_reminders(): ya iteraba por grupo — ahora también calcula
-- "hoy" con el timezone de ESE grupo, y solo manda el recordatorio si ahora
-- mismo son las 6pm en esa zona. Necesario porque el cron pasa de correr una
-- vez al día a cada hora (ver más abajo): sin este chequeo, cada grupo
-- recibiría el recordatorio 24 veces al día en vez de una.
-- ----------------------------------------------------------------------------
create or replace function send_checkin_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_today date;
  v_local_hour int;
  v_user_ids uuid[];
begin
  for v_group in select id, name, timezone from groups loop
    v_local_hour := extract(hour from (now() at time zone v_group.timezone))::int;
    if v_local_hour <> 18 then
      continue;
    end if;
    v_today := (now() at time zone v_group.timezone)::date;

    select array_agg(distinct gm.user_id) into v_user_ids
    from group_members gm
    where gm.group_id = v_group.id
      and gm.status in ('pending_deposit', 'active', 'needs_recharge')
      and (coalesce(gm.activated_at, gm.joined_at) at time zone v_group.timezone)::date <= v_today
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
        v_user_ids, 'Gym Buddies',
        format('No olvides hacer tu check-in de hoy en "%s" 💪', v_group.name),
        p_group_id => v_group.id, p_category => 'reminders'
      );
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_set_member_activation_date() / admin_set_member_penalty_start_date():
-- la fecha que teclea el admin (un plain date, sin hora) se interpreta en el
-- timezone del GRUPO del miembro, no en Bogotá fijo.
-- ----------------------------------------------------------------------------
create or replace function admin_set_member_activation_date(p_member_id uuid, p_date date)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
  v_tz text;
begin
  select * into v_member from group_members where id = p_member_id;
  if not found then
    raise exception 'member not found';
  end if;
  if not is_group_admin(v_member.group_id) then
    raise exception 'only the group admin can change a member''s activation date';
  end if;

  select timezone into v_tz from groups where id = v_member.group_id;

  update group_members
    set activated_at = (p_date::timestamp) at time zone v_tz
    where id = p_member_id
    returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Tu fecha de entrada cambió',
    format('El administrador ajustó la fecha desde la que cuentan tus días a partir del %s.', to_char(p_date, 'DD/MM/YYYY')),
    p_group_id => v_member.group_id, p_category => 'admin_actions'
  );

  return v_member;
end;
$$;

create or replace function admin_set_member_penalty_start_date(p_member_id uuid, p_date date)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
  v_tz text;
begin
  select * into v_member from group_members where id = p_member_id;
  if not found then
    raise exception 'member not found';
  end if;
  if not is_group_admin(v_member.group_id) then
    raise exception 'only the group admin can change a member''s penalty start date';
  end if;

  select timezone into v_tz from groups where id = v_member.group_id;

  update group_members
    set penalty_start_date = (p_date::timestamp) at time zone v_tz
    where id = p_member_id
    returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Tu fecha de inicio de penalizaciones cambió',
    format('El administrador ajustó la fecha desde la que pueden penalizarte a partir del %s.', to_char(p_date, 'DD/MM/YYYY')),
    p_group_id => v_member.group_id, p_category => 'admin_actions'
  );

  return v_member;
end;
$$;

-- ----------------------------------------------------------------------------
-- close_expired_proposals() / resolve_rule_proposal(): "próximo lunes"
-- calculado en el timezone del grupo de la propuesta, no en Bogotá.
-- ----------------------------------------------------------------------------
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
  v_tz text;
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
      select timezone into v_tz from groups where id = v_proposal.group_id;
      update rule_proposals
        set status = 'approved',
            decided_at = now(),
            effective_at = case
              when v_proposal.apply_immediately then now()
              else (
                (date_trunc('week', (now() at time zone v_tz)) + interval '1 week')
                  at time zone v_tz
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
          p_group_id => v_proposal.group_id, p_category => 'votes'
        );
      end if;

      if v_proposal.apply_immediately then
        perform apply_rule_proposal(v_proposal.id);
      end if;
    else
      update rule_proposals set status = 'rejected', decided_at = now() where id = v_proposal.id;

      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Propuesta rechazada', 'La propuesta de regla fue rechazada por el grupo.',
          p_group_id => v_proposal.group_id, p_category => 'votes'
        );
      end if;
    end if;
  end loop;
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
  v_tz text;
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
    select timezone into v_tz from groups where id = v_proposal.group_id;
    update rule_proposals
      set status = 'approved',
          decided_at = now(),
          effective_at = case
            when v_proposal.apply_immediately then now()
            else (
              (date_trunc('week', (now() at time zone v_tz)) + interval '1 week')
                at time zone v_tz
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
        p_group_id => v_proposal.group_id, p_category => 'votes'
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
        v_recipient_ids, 'Propuesta rechazada', 'La propuesta de regla fue rechazada por el grupo.',
        p_group_id => v_proposal.group_id, p_category => 'votes'
      );
    end if;
  end if;

  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_group(): la fecha mostrada en la notificación de "salida en proceso"
-- usa el timezone del grupo, no Bogotá — solo afecta el texto, no el
-- cálculo real de leave_effective_at (que ya es un timestamptz absoluto).
-- ----------------------------------------------------------------------------
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

    perform pay_out_departing_member(p_group_id, auth.uid());

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
      format('Tu salida del grupo será efectiva el %s.', to_char(v_member.leave_effective_at at time zone v_group.timezone, 'DD/MM/YYYY')),
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

-- ----------------------------------------------------------------------------
-- create_group(): acepta el timezone del nuevo grupo (default Bogotá para no
-- romper llamadas viejas que aún no mandan este parámetro).
-- ----------------------------------------------------------------------------
create or replace function create_group(
  p_name text,
  p_initial_deposit_amount numeric,
  p_min_days_per_week int,
  p_penalty_amount numeric,
  p_weekly_penalty_cap numeric,
  p_exit_fee_amount numeric,
  p_exit_notice_days int,
  p_require_checkout_photo boolean default false,
  p_min_workout_minutes int default 0,
  p_admin_payment_info text default null,
  p_payout_mode text default 'cooperative',
  p_league_duration_months int default 3,
  p_league_prize_splits jsonb default '[60, 30, 10]'::jsonb,
  p_mixed_league_share_percent numeric default 50,
  p_game_starts_at date default null,
  p_timezone text default 'America/Bogota'
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
begin
  insert into groups (
    name, invite_code, admin_id, initial_deposit_amount, min_days_per_week,
    penalty_amount, weekly_penalty_cap, exit_fee_amount, exit_notice_days,
    require_checkout_photo, min_workout_minutes, admin_payment_info,
    payout_mode, league_duration_months, league_prize_splits, mixed_league_share_percent,
    game_starts_at, timezone
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info,
    p_payout_mode, p_league_duration_months, p_league_prize_splits, p_mixed_league_share_percent,
    case when p_game_starts_at is not null then (p_game_starts_at::timestamp) at time zone p_timezone else null end,
    p_timezone
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', 'pending_deposit');
  return v_group;
end;
$$;

-- ----------------------------------------------------------------------------
-- Cron: weekly-evaluation y checkin-reminder pasan de una vez fija en UTC
-- (afinada para medianoche/6pm Bogotá) a cada hora. run_weekly_evaluation ya
-- es idempotente por (group_id, week_start_date); send_checkin_reminders
-- ahora se auto-filtra por hora local de cada grupo (ver arriba) — así cada
-- grupo se evalúa/recuerda cerca de SU propia medianoche/6pm, sin importar
-- en qué timezone esté.
-- ----------------------------------------------------------------------------
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'weekly-evaluation'), schedule := '0 * * * *');
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'checkin-reminder'), schedule := '0 * * * *');

-- ----------------------------------------------------------------------------
-- admin-edit-group.tsx updates timezone via a direct client .update() (same
-- pattern already used for name/admin_payment_info) — 0009's column grant
-- only covered those two, so timezone needs adding here too. The RLS row
-- policy (groups_update_admin, 0009) already covers "is this group's admin";
-- trg_validate_group_timezone above covers "is this a real IANA zone".
-- ----------------------------------------------------------------------------
grant update (timezone) on groups to authenticated;

-- ----------------------------------------------------------------------------
-- delete_own_checkin() (0037): missed in the first pass of this migration —
-- its "only today's check-in" guard still compared against Bogota. Without
-- this, a member in a timezone far enough ahead of Bogota (e.g. Shanghai,
-- +13h) would routinely have their own same-day retake/delete rejected with
-- "solo puedes eliminar el check-in de hoy", since Bogota's calendar date
-- hadn't rolled over yet even though it genuinely was still "today" in
-- their own group's timezone.
-- ----------------------------------------------------------------------------
create or replace function delete_own_checkin(p_checkin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_tz text;
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;

  select timezone into v_tz from groups where id = v_checkin.group_id;
  if v_checkin.checkin_date <> (now() at time zone v_tz)::date then
    raise exception 'solo puedes eliminar el check-in de hoy';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.photo_path;
  if v_checkin.checkout_photo_path is not null then
    delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.checkout_photo_path;
  end if;
  delete from checkins where id = p_checkin_id;
end;
$$;
