-- ============================================================================
-- Root cause of the Supabase error a pending_deposit member hit trying to
-- take their check-in photo: is_voting_member() — the single gate behind
-- submit_checkin, submit_workout_checkout (via the checkin row it requires),
-- cast_vote, create_excuse_request, create_photo_challenge,
-- cast_photo_challenge_vote, and the checkin/excuse-proof storage policies —
-- only let 'active'/'needs_recharge' members through. But deposit.tsx
-- already tells the member "ya puedes usar la app normalmente" the instant
-- they submit their receipt, before any admin confirms it; the backend just
-- never actually allowed that. Widening this one shared gate fixes every
-- one of those call sites at once — same precedent as needs_recharge
-- already gets today: keep letting them participate, worry about money
-- separately. Balance already has no floor (no CHECK constraint, and
-- apply_wallet_transaction_effect just adds the transaction amount), so
-- that alone is what lets it go negative once they fail a day.
-- ============================================================================
create or replace function is_voting_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id
      and user_id = p_user_id
      and status in ('pending_deposit', 'active', 'needs_recharge')
  );
$$;

-- run_weekly_evaluation and send_checkin_reminders inline their own member
-- filter instead of calling is_voting_member — widen both the same way, so
-- a pending_deposit member's attendance is actually evaluated (and
-- penalized, same as anyone else) and they get reminded to check in too,
-- instead of silently being skipped every week.
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
    perform send_push_notification(v_user_ids, 'Gym Buddies', 'No olvides hacer tu check-in de hoy 💪');
  end if;
end;
$$;
