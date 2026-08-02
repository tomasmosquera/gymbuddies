-- ============================================================================
-- Two follow-ups from reviewing the payout-mode feature with the user:
--
-- 1. Liga mode shouldn't charge ANY weekly penalty — training 7 days or 0
--    days should cost nothing extra; only the end-of-cycle podium matters.
--    completed/failed days are still tracked (the podium ranking needs
--    them), only the monetary penalty itself is suppressed.
--
-- 2. Groups can now set a game_starts_at date at creation — a group-wide
--    floor under every member's activated_at, for "we're creating the group
--    today but really start playing on Aug 15" (Daniel/Juan-Felipe-style
--    per-member activation dates already existed; this is the same idea
--    applied group-wide, at creation time, so it needs no per-member setup).
--    Implemented as a floor on the one place activated_at ever gets
--    auto-set (apply_wallet_transaction_effect, on first confirmed
--    deposit) — every downstream consumer (ranking, penalties,
--    consistency, badges, voting gates) already respects activated_at, so
--    nothing else needs to change.
-- ============================================================================
alter table groups add column game_starts_at timestamptz;

-- ============================================================================
-- create_group: accept payout-mode config and the game-start date at
-- creation time too, not just via rule proposals after the fact.
-- ============================================================================
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
  p_game_starts_at date default null
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
    game_starts_at
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info,
    p_payout_mode, p_league_duration_months, p_league_prize_splits, p_mixed_league_share_percent,
    case when p_game_starts_at is not null then (p_game_starts_at::timestamp) at time zone 'America/Bogota' else null end
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', 'pending_deposit');
  return v_group;
end;
$$;

-- ============================================================================
-- apply_wallet_transaction_effect: activated_at, when auto-set on first
-- confirmed deposit, is now floored by the group's game_starts_at (if any)
-- — greatest() means a past/null game_starts_at behaves exactly as before.
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
            when activated_at is null and balance + new.amount > 0 and status = 'pending_deposit'
              then greatest(now(), coalesce((select game_starts_at from groups where id = new.group_id), now()))
            else activated_at
          end
      where group_id = new.group_id and user_id = new.user_id;
  end if;

  if tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'confirmed'
     and new.type in ('recharge', 'initial_deposit') then
    perform send_push_notification(
      array[new.user_id], 'Gym Buddies', 'Tu recarga fue confirmada por el administrador.',
      p_group_id => new.group_id, p_category => 'money'
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'rejected'
     and new.type in ('recharge', 'initial_deposit') then
    perform send_push_notification(
      array[new.user_id], 'Gym Buddies', 'Tu recarga fue rechazada por el administrador. Revisa el comprobante y vuelve a intentarlo.',
      p_group_id => new.group_id, p_category => 'money'
    );
  end if;
  return new;
end;
$$;

-- ============================================================================
-- run_weekly_evaluation: Liga mode never charges a penalty. completed_days/
-- failed_days/required_days are still computed and stored unchanged (the
-- podium ranking sums exactly these), only v_penalty is forced to 0 and the
-- weekly-result push message gets a dedicated Liga wording.
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
      v_activated_date := (coalesce(v_member.activated_at, v_member.joined_at) at time zone 'America/Bogota')::date;
      v_penalty_start_date := (
        coalesce(v_member.penalty_start_date, v_member.activated_at, v_member.joined_at) at time zone 'America/Bogota'
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
