-- ============================================================================
-- pay_out_departing_member: the money-conservation primitive behind
-- Cooperativo/Mixto. Spreads a computed delta across a locked set of
-- members as ordinary 'payout' wallet_transactions rows — the existing
-- balance-mutation trigger (apply_wallet_transaction_effect, 0007) does all
-- the real work, so the sum-of-balances invariant is exact by construction.
--
-- Contract: call this BEFORE flipping the departing member's status away
-- from active/needs_recharge (it reads them as still-active to compute
-- their fair share). No-op for 'league' mode (pure Liga only pays out at
-- cycle end) or for a member who never had an active balance to begin with
-- (pending_deposit, or already gone).
--
-- Not exposed to clients directly (see revoke at the bottom) — it assumes
-- its caller has already decided this member is really departing right
-- now; called from leave_group, process_scheduled_leaves, and
-- admin_remove_member, all of which run as SECURITY DEFINER themselves so
-- the nested call succeeds despite the revoke.
-- ============================================================================
create or replace function pay_out_departing_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_departing group_members%rowtype;
  v_pool_before numeric(12, 2);
  v_coop_pool numeric(12, 2);
  v_n_before int;
  v_share numeric(12, 2);
  v_remaining_count int;
  v_delta_total numeric(12, 2);
  v_delta_cents bigint;
  v_base_cents bigint;
  v_remainder_cents int;
  v_sign int;
  v_member_idx int := 0;
  v_remaining record;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.payout_mode = 'league' then
    return;
  end if;

  -- Lock every currently-active member (including the departing one, whose
  -- status hasn't flipped yet) so the pool total can't shift underneath us.
  perform 1 from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge')
    for update;

  select * into v_departing
    from group_members
    where group_id = p_group_id and user_id = p_user_id and status in ('active', 'needs_recharge');
  if not found then
    return;
  end if;

  select count(*), coalesce(sum(balance), 0) into v_n_before, v_pool_before
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge');

  v_coop_pool := case
    when v_group.payout_mode = 'mixed' then v_pool_before * (1 - v_group.mixed_league_share_percent / 100)
    else v_pool_before
  end;
  v_share := greatest(round(v_coop_pool / v_n_before, 2), 0);
  v_remaining_count := v_n_before - 1;

  insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
    values (
      p_group_id, p_user_id, 'payout', -v_departing.balance, 'confirmed',
      format('salida del grupo: se liquida tu saldo, te corresponden %s %s del fondo', v_share, v_group.currency),
      now()
    );

  if v_remaining_count > 0 then
    v_delta_total := v_departing.balance - v_share;
    v_delta_cents := round(v_delta_total * 100);
    v_base_cents := trunc(v_delta_cents::numeric / v_remaining_count)::bigint;
    v_remainder_cents := (v_delta_cents - v_base_cents * v_remaining_count)::int;
    v_sign := sign(v_remainder_cents)::int;

    for v_remaining in
      select user_id from group_members
        where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> p_user_id
        order by joined_at asc
    loop
      v_member_idx := v_member_idx + 1;
      insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
        values (
          p_group_id, v_remaining.user_id, 'payout',
          (v_base_cents + case when v_member_idx <= abs(v_remainder_cents) then v_sign else 0 end) / 100.0,
          'confirmed', 'ajuste de fondo común por salida de un miembro', now()
        );
    end loop;
  end if;

  perform send_push_notification(
    array[p_user_id], 'Saldo liquidado',
    format('Tu salida del fondo común te corresponde %s %s.', v_share, v_group.currency),
    p_group_id => p_group_id, p_category => 'money'
  );

  if v_group.admin_id is not null and v_group.admin_id <> p_user_id then
    perform send_push_notification(
      array[v_group.admin_id], 'Pago de salida registrado',
      format('Se liquidó el saldo de un miembro que salió del grupo — le corresponden %s %s del fondo común.', v_share, v_group.currency),
      p_group_id => p_group_id, p_category => 'money'
    );
  end if;
end;
$$;

revoke execute on function pay_out_departing_member(uuid, uuid) from authenticated;

-- ============================================================================
-- leave_group: immediate-leave branch now pays out the Cooperativo/Mixto
-- share (via pay_out_departing_member) before the exit fee's effect is
-- already reflected in the pool — order is: exit fee charged first (it
-- reduces what the departing member takes with them and what's left in the
-- pool to redistribute), then the payout, then the status flip. The
-- scheduled/notice branch is unaffected here — its payout happens later,
-- at the effective date, in process_scheduled_leaves.
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

-- ============================================================================
-- process_scheduled_leaves: still per-group batching for notifications
-- (unchanged wording/grouping), but the payout+status-flip is now a
-- strictly sequential per-member loop within each group — required because
-- if two members of the same group are both due in the same cron run, the
-- second one's payout must see the first one's already-processed departure
-- (pool_before must reflect it), which a bulk update couldn't guarantee.
-- ============================================================================
create or replace function process_scheduled_leaves()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_member record;
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

    for v_member in
      select id, user_id from group_members
        where group_id = v_group.id
          and leave_effective_at is not null and leave_effective_at <= now()
          and status not in ('left', 'removed')
        order by leave_effective_at asc
    loop
      perform pay_out_departing_member(v_group.id, v_member.user_id);
      update group_members
        set status = 'left', leave_requested_at = null, leave_effective_at = null
        where id = v_member.id;
    end loop;

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

-- ============================================================================
-- admin_remove_member: gains p_pay_out (default true, so existing callers
-- keep today's "pay them their fair share" behavior). An admin removing
-- someone for cause (fraud, non-payment, abuse) can pass false to skip the
-- Cooperativo/Mixto payout entirely, leaving their balance untouched on the
-- now-'removed' row for the admin to sort out manually — same reasoning as
-- leave_group's exit fee, just an admin-side judgment call instead.
-- ============================================================================
create or replace function admin_remove_member(p_member_id uuid, p_pay_out boolean default true)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
  v_group groups%rowtype;
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

  select * into v_group from groups where id = v_member.group_id;

  if p_pay_out and v_group.payout_mode in ('cooperative', 'mixed') and v_member.status in ('active', 'needs_recharge') then
    perform pay_out_departing_member(v_member.group_id, v_member.user_id);
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

-- ============================================================================
-- evaluate_due_league_cycle: Liga/Mixto cycle-end podium payout. Called
-- from run_weekly_evaluation (see below) so this week's
-- weekly_evaluation_results rows are guaranteed to already exist when the
-- podium sums them — a standalone timer could race against the weekly job
-- for the same week.
--
-- Podium eligibility = still active today (leaving early forfeits the
-- prize entirely — the same status filter does both jobs). Ranked by the
-- same consistency metric as rankMembersByConsistency
-- (src/lib/domain/attendance.ts), summed over the cycle's window, with the
-- same standard-competition-ranking tie semantics (RANK(): ties share a
-- rank, next distinct rank skips by the tie count) — which is exactly how
-- many prize slots a tied group should jointly consume.
-- ============================================================================
create or replace function evaluate_due_league_cycle(p_group_id uuid, p_as_of_week_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_prize_len int;
  v_pool_total numeric(12, 2);
  v_pool_for_league numeric(12, 2);
  v_total_distributed numeric(12, 2) := 0;
  v_rank_group record;
  v_split_idx int;
  v_merged_percent numeric(5, 2);
  v_winner_user_id uuid;
  v_winner_amount numeric(12, 2);
  v_wtx_id uuid;
  v_active_count int;
  v_delta_cents bigint;
  v_base_cents bigint;
  v_remainder_cents int;
  v_sign int;
  v_member_idx int := 0;
  v_member record;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.payout_mode = 'cooperative' then
    return;
  end if;

  select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running' for update;
  if not found or v_cycle.ends_at::date > p_as_of_week_end then
    return;
  end if;

  perform 1 from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge')
    for update;

  select coalesce(sum(balance), 0) into v_pool_total
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

  v_pool_for_league := greatest(v_pool_total * v_cycle.league_share_percent / 100, 0);
  v_prize_len := jsonb_array_length(v_cycle.prize_splits);

  for v_rank_group in
    with per_user as (
      select wer.user_id, sum(wer.completed_days) as completed, sum(wer.failed_days) as failed
        from weekly_evaluation_results wer
        join weekly_evaluation_runs wr on wr.id = wer.run_id
        where wer.group_id = p_group_id
          and wr.week_start_date >= v_cycle.started_at::date
          and wr.week_end_date <= v_cycle.ends_at::date
        group by wer.user_id
    ),
    per_user_minutes as (
      select c.user_id, sum(c.workout_minutes) as minutes
        from checkins c
        where c.group_id = p_group_id
          and c.checkin_date >= v_cycle.started_at::date
          and c.checkin_date <= v_cycle.ends_at::date
        group by c.user_id
    ),
    eligible as (
      select gm.user_id from group_members gm
        where gm.group_id = p_group_id and gm.status in ('active', 'needs_recharge')
    ),
    ranked as (
      select
        e.user_id,
        rank() over (
          order by
            coalesce(pu.completed - pu.failed, -999999) desc,
            case when v_group.require_checkout_photo then coalesce(pum.minutes, 0) else 0 end desc
        ) as place
        from eligible e
        left join per_user pu on pu.user_id = e.user_id
        left join per_user_minutes pum on pum.user_id = e.user_id
    )
    select place, array_agg(user_id order by user_id) as users, count(*)::int as k
      from ranked
      group by place
      order by place
  loop
    exit when v_rank_group.place > v_prize_len;

    v_merged_percent := 0;
    for v_split_idx in v_rank_group.place .. least(v_rank_group.place + v_rank_group.k - 1, v_prize_len) loop
      v_merged_percent := v_merged_percent + (v_cycle.prize_splits ->> (v_split_idx - 1))::numeric;
    end loop;
    v_merged_percent := v_merged_percent / v_rank_group.k;

    foreach v_winner_user_id in array v_rank_group.users loop
      v_winner_amount := round(v_pool_for_league * v_merged_percent / 100, 2);
      if v_winner_amount > 0 then
        insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
          values (
            p_group_id, v_winner_user_id, 'payout', v_winner_amount, 'confirmed',
            format('premio de liga: puesto %s (%s%%)', v_rank_group.place, v_merged_percent), now()
          ) returning id into v_wtx_id;

        insert into league_cycle_payouts (cycle_id, user_id, place, share_percent, amount, wallet_transaction_id)
          values (v_cycle.id, v_winner_user_id, v_rank_group.place, v_merged_percent, v_winner_amount, v_wtx_id);

        v_total_distributed := v_total_distributed + v_winner_amount;
      end if;
    end loop;
  end loop;

  -- Fund the prize: spread the cost equally across every currently active
  -- member, including the winners themselves — exactly how a shared pot
  -- works (everyone funds the prize equally, winners additionally collect).
  if v_total_distributed > 0 then
    select count(*) into v_active_count
      from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

    v_delta_cents := round(-v_total_distributed * 100);
    v_base_cents := trunc(v_delta_cents::numeric / v_active_count)::bigint;
    v_remainder_cents := (v_delta_cents - v_base_cents * v_active_count)::int;
    v_sign := sign(v_remainder_cents)::int;

    for v_member in
      select user_id from group_members
        where group_id = p_group_id and status in ('active', 'needs_recharge')
        order by joined_at asc
    loop
      v_member_idx := v_member_idx + 1;
      insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
        values (
          p_group_id, v_member.user_id, 'payout',
          (v_base_cents + case when v_member_idx <= abs(v_remainder_cents) then v_sign else 0 end) / 100.0,
          'confirmed', 'aporte al premio del ciclo de liga', now()
        );
    end loop;
  end if;

  update league_cycles
    set status = 'completed', completed_at = now(), pool_at_payout = v_pool_for_league
    where id = v_cycle.id;

  perform send_push_notification(
    (select array_agg(user_id) from group_members where group_id = p_group_id and status in ('active', 'needs_recharge')),
    'Ciclo de Liga terminado', 'Se repartió el premio del ciclo de Liga — revisa Reglas para ver los resultados.',
    p_group_id => p_group_id, p_category => 'money'
  );

  if v_group.admin_id is not null then
    perform send_push_notification(
      array[v_group.admin_id], 'Inicia un nuevo ciclo de Liga',
      'El ciclo anterior terminó y el premio ya se repartió. Puedes iniciar el próximo ciclo desde Reglas.',
      p_group_id => p_group_id, p_category => 'admin_actions'
    );
  end if;
end;
$$;

-- ============================================================================
-- run_weekly_evaluation: unchanged except for one new line — after this
-- week's weekly_evaluation_results rows exist for every member (needed for
-- evaluate_due_league_cycle's podium sums to be complete) and before the
-- due-rule-proposal check, see if this group's league cycle is due.
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

      v_penalty := least(v_failed_for_penalty * v_group.penalty_amount, v_group.weekly_penalty_cap);

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

      if v_failed = 0 then
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

-- ============================================================================
-- start_league_cycle: admin-only. Snapshots the group's current league
-- config into a new league_cycles row so later config changes never alter
-- an already-running cycle (same snapshot idiom as
-- rule_proposals.member_count_snapshot).
-- ============================================================================
create or replace function start_league_cycle(p_group_id uuid)
returns league_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_next_number int;
  v_recipient_ids uuid[];
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can start a league cycle';
  end if;
  if v_group.payout_mode = 'cooperative' then
    raise exception 'this group is not in league or mixed mode';
  end if;
  if exists (select 1 from league_cycles where group_id = p_group_id and status = 'running') then
    raise exception 'a league cycle is already running for this group';
  end if;

  select coalesce(max(cycle_number), 0) + 1 into v_next_number from league_cycles where group_id = p_group_id;

  insert into league_cycles (
    group_id, cycle_number, prize_splits, duration_months, league_share_percent, started_at, ends_at
  ) values (
    p_group_id, v_next_number, v_group.league_prize_splits, v_group.league_duration_months,
    case when v_group.payout_mode = 'mixed' then v_group.mixed_league_share_percent else 100 end,
    now(), now() + (v_group.league_duration_months || ' months')::interval
  ) returning * into v_cycle;

  select array_agg(user_id) into v_recipient_ids
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Empezó un ciclo de Liga',
      format('Arrancó el ciclo #%s — dura %s mes(es).', v_next_number, v_group.league_duration_months),
      p_group_id => p_group_id, p_category => 'group_activity'
    );
  end if;

  return v_cycle;
end;
$$;

-- ============================================================================
-- apply_rule_proposal / apply_rule_change_direct: extend the coalesce block
-- with the 4 payout-mode fields, same pattern as every other rule field.
-- If a change moves a group OFF league/mixed and back to 'cooperative',
-- any running cycle is cancelled with no payout (the pool just continues
-- untouched under Cooperativo). Switching between 'league' and 'mixed'
-- does NOT touch a running cycle — its snapshot stays frozen until the
-- next start_league_cycle call.
-- ============================================================================
create or replace function apply_rule_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal rule_proposals%rowtype;
  v_old_mode text;
begin
  select * into v_proposal from rule_proposals where id = p_proposal_id for update;
  if not found or v_proposal.applied_at is not null then
    return;
  end if;

  select payout_mode into v_old_mode from groups where id = v_proposal.group_id;

  update groups g
    set min_days_per_week = coalesce((v_proposal.proposed_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
        penalty_amount = coalesce((v_proposal.proposed_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
        weekly_penalty_cap = coalesce((v_proposal.proposed_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
        exit_fee_amount = coalesce((v_proposal.proposed_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
        exit_notice_days = coalesce((v_proposal.proposed_changes ->> 'exit_notice_days')::int, g.exit_notice_days),
        require_checkout_photo = coalesce((v_proposal.proposed_changes ->> 'require_checkout_photo')::boolean, g.require_checkout_photo),
        min_workout_minutes = coalesce((v_proposal.proposed_changes ->> 'min_workout_minutes')::int, g.min_workout_minutes),
        payout_mode = coalesce(v_proposal.proposed_changes ->> 'payout_mode', g.payout_mode),
        league_duration_months = coalesce((v_proposal.proposed_changes ->> 'league_duration_months')::int, g.league_duration_months),
        league_prize_splits = coalesce(v_proposal.proposed_changes -> 'league_prize_splits', g.league_prize_splits),
        mixed_league_share_percent = coalesce((v_proposal.proposed_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent)
    where g.id = v_proposal.group_id;

  if v_old_mode in ('league', 'mixed') and (v_proposal.proposed_changes ->> 'payout_mode') = 'cooperative' then
    update league_cycles set status = 'cancelled', completed_at = now()
      where group_id = v_proposal.group_id and status = 'running';
  end if;

  update rule_proposals set status = 'applied', applied_at = now() where id = p_proposal_id;
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
  v_old_mode text;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can apply rule changes directly';
  end if;

  select payout_mode into v_old_mode from groups where id = p_group_id;

  update groups g
    set min_days_per_week = coalesce((p_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
        penalty_amount = coalesce((p_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
        weekly_penalty_cap = coalesce((p_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
        exit_fee_amount = coalesce((p_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
        exit_notice_days = coalesce((p_changes ->> 'exit_notice_days')::int, g.exit_notice_days),
        require_checkout_photo = coalesce((p_changes ->> 'require_checkout_photo')::boolean, g.require_checkout_photo),
        min_workout_minutes = coalesce((p_changes ->> 'min_workout_minutes')::int, g.min_workout_minutes),
        payout_mode = coalesce(p_changes ->> 'payout_mode', g.payout_mode),
        league_duration_months = coalesce((p_changes ->> 'league_duration_months')::int, g.league_duration_months),
        league_prize_splits = coalesce(p_changes -> 'league_prize_splits', g.league_prize_splits),
        mixed_league_share_percent = coalesce((p_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent)
    where g.id = p_group_id
    returning * into v_group;

  if not found then
    raise exception 'group not found';
  end if;

  if v_old_mode in ('league', 'mixed') and (p_changes ->> 'payout_mode') = 'cooperative' then
    update league_cycles set status = 'cancelled', completed_at = now()
      where group_id = p_group_id and status = 'running';
  end if;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Reglas actualizadas',
      'El administrador actualizó las reglas del grupo directamente, sin necesidad de votación.',
      p_group_id => p_group_id, p_category => 'votes'
    );
  end if;

  return v_group;
end;
$$;
