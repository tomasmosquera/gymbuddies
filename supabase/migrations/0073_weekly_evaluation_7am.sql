-- ============================================================================
-- run_weekly_evaluation() currently fires as soon as each group's local date
-- rolls over to Monday (the hourly cron tick right after local midnight —
-- see 0070_group_timezone_support.sql), so the "Resultado semanal" push
-- lands around 12:01am local time. Moving it to 7:00am local instead: same
-- idiom already used by send_checkin_reminders() (a strict v_local_hour <>
-- N check) — the hourly cron keeps running every hour regardless, but the
-- group is now skipped entirely until the local hour is exactly 7. The
-- existing idempotency (unique_violation on weekly_evaluation_runs ->
-- continue) still guarantees only the Monday 7am tick actually evaluates —
-- every other day's 7am tick computes the same already-recorded
-- week_start_date and no-ops.
-- ============================================================================
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
  v_local_hour int;
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
    v_local_hour := extract(hour from (now() at time zone v_group.timezone))::int;
    if v_local_hour <> 7 then
      continue;
    end if;

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
