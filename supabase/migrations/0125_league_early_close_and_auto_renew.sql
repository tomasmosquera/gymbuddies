-- ============================================================================
-- League cycles: whole-week alignment, early close, and optional auto-renew.
--
-- 1) ALIGNMENT. A cycle is graded on whole Monday-Sunday weeks that were
--    already evaluated (evaluate_due_league_cycle counts only weeks that
--    start on/after the cycle's start date and end on/before its end date, and
--    only settles from the Monday evaluation). The old rule
--    "ends_at = started_at + N*7 days" therefore landed the end on a MONDAY
--    for a Monday start, and the cycle paid out a whole week late.
--    From now on EVERY cycle start snaps to the Monday of the week it starts
--    in (started_at = that Monday 00:00 in the group's timezone) and the cycle
--    ends at Sunday 23:59:59 of its last week, so the Monday 08:00 evaluation
--    right after settles it immediately. The day the admin actually picked is
--    kept in effective_start_date; the days of that first week BEFORE it are
--    treated as excused for everyone (run_weekly_evaluation below), so nobody
--    is marked as failing days that happened before the cycle began.
--    All date arithmetic is done in the group's timezone (the old code cast
--    timestamptz to date in the session's UTC zone).
--
-- 2) EARLY CLOSE. admin_close_league_cycle_early() moves a running cycle's end
--    to THIS week's Sunday: the Monday evaluation settles it with final
--    positions. The original end is kept in original_ends_at (so it can be
--    cancelled until the week is over) and closed_early flags it in history.
--    Changing the cycle's start date clears a pending early close.
--
-- 3) AUTO-RENEW. groups.league_auto_renew (default OFF for every group): when
--    on, settling a cycle immediately starts the next one, beginning that same
--    Monday, instead of only notifying the admin to start it by hand. An early
--    close follows the same toggle.
--
-- Also: the one running cycle whose end date was on a Tuesday (started with the
-- old months rule) is moved to the Sunday before it, so it settles on time.
-- ============================================================================

alter table groups add column league_auto_renew boolean not null default false;

alter table league_cycles add column effective_start_date date;
alter table league_cycles add column closed_early boolean not null default false;
alter table league_cycles add column original_ends_at timestamptz;

update league_cycles c
  set effective_start_date = (c.started_at at time zone g.timezone)::date
  from groups g
  where g.id = c.group_id;

alter table league_cycles alter column effective_start_date set not null;

-- ---- align the running cycle(s) that predate the rule ------------------------
do $$
declare
  v_cycle record;
  v_end_local timestamp;
  v_sunday date;
begin
  for v_cycle in
    select c.id, c.ends_at, g.timezone
      from league_cycles c join groups g on g.id = c.group_id
      where c.status = 'running'
  loop
    v_end_local := v_cycle.ends_at at time zone v_cycle.timezone;
    if extract(isodow from v_end_local) = 7 and v_end_local::time = time '23:59:59' then
      continue;
    end if;
    v_sunday := v_end_local::date - (extract(isodow from v_end_local)::int % 7);
    update league_cycles
      set ends_at = ((v_sunday + 1)::timestamp at time zone v_cycle.timezone) - interval '1 second'
      where id = v_cycle.id;
  end loop;
end;
$$;

-- ---- the week window of a cycle ------------------------------------------------
create or replace function league_cycle_bounds(p_start_date date, p_weeks int, p_timezone text)
returns table (cycle_start timestamptz, cycle_end timestamptz)
language sql
stable
as $$
  select
    (date_trunc('week', p_start_date::timestamp)::date)::timestamp at time zone p_timezone,
    ((date_trunc('week', p_start_date::timestamp)::date + p_weeks * 7)::timestamp at time zone p_timezone)
      - interval '1 second';
$$;

-- ---- start_league_cycle_at: snap to the Monday of the start week ----------------
create or replace function start_league_cycle_at(p_group_id uuid, p_started_at timestamptz)
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
  v_start_date date;
  v_bounds record;
begin
  select * into v_group from groups where id = p_group_id;

  v_start_date := (p_started_at at time zone v_group.timezone)::date;
  select * into v_bounds from league_cycle_bounds(v_start_date, v_group.league_duration_weeks, v_group.timezone);

  select coalesce(max(cycle_number), 0) + 1 into v_next_number from league_cycles where group_id = p_group_id;

  insert into league_cycles (
    group_id, cycle_number, prize_splits, duration_weeks, league_share_percent,
    started_at, ends_at, effective_start_date
  ) values (
    p_group_id, v_next_number, v_group.league_prize_splits, v_group.league_duration_weeks,
    case when v_group.payout_mode = 'mixed' then v_group.mixed_league_share_percent else 100 end,
    v_bounds.cycle_start, v_bounds.cycle_end, v_start_date
  ) returning * into v_cycle;

  select array_agg(user_id) into v_recipient_ids
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Empezó un ciclo de Liga',
      format(
        'Arrancó el ciclo #%s — dura %s semana(s) y cierra el domingo %s.',
        v_next_number, v_group.league_duration_weeks,
        to_char((v_bounds.cycle_end at time zone v_group.timezone)::date, 'DD/MM/YYYY')
      ),
      p_group_id => p_group_id, p_category => 'group_activity'
    );
  end if;

  return v_cycle;
end;
$$;

-- ---- set_running_league_cycle_start: same snapping; clears an early close --------
create or replace function set_running_league_cycle_start(p_group_id uuid, p_started_at date)
returns league_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_bounds record;
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;

  select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running' for update;
  if not found then
    return null;
  end if;

  select * into v_bounds from league_cycle_bounds(p_started_at, v_cycle.duration_weeks, v_group.timezone);

  update league_cycles
    set started_at = v_bounds.cycle_start,
        ends_at = v_bounds.cycle_end,
        effective_start_date = p_started_at,
        closed_early = false,
        original_ends_at = null
    where id = v_cycle.id
    returning * into v_cycle;

  return v_cycle;
end;
$$;

-- ---- early close ------------------------------------------------------------------
create or replace function admin_close_league_cycle_early(p_group_id uuid)
returns league_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_local_today date;
  v_new_end timestamptz;
  v_sunday date;
  v_recipient_ids uuid[];
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can close a league cycle early';
  end if;

  select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running' for update;
  if not found then
    raise exception 'there is no running league cycle for this group';
  end if;
  if v_cycle.closed_early then
    raise exception 'this league cycle is already scheduled to close early';
  end if;

  v_local_today := (now() at time zone v_group.timezone)::date;
  v_sunday := date_trunc('week', v_local_today::timestamp)::date + 6;
  v_new_end := ((v_sunday + 1)::timestamp at time zone v_group.timezone) - interval '1 second';

  if v_new_end >= v_cycle.ends_at then
    raise exception 'this league cycle already ends this week';
  end if;
  if v_new_end <= v_cycle.started_at then
    raise exception 'this league cycle has not started yet';
  end if;

  update league_cycles
    set original_ends_at = ends_at, ends_at = v_new_end, closed_early = true
    where id = v_cycle.id
    returning * into v_cycle;

  select array_agg(user_id) into v_recipient_ids
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Cierre anticipado de la Liga',
      format(
        'El administrador cerrará el ciclo #%s este domingo %s. El lunes se conocen las posiciones finales%s.',
        v_cycle.cycle_number, to_char(v_sunday, 'DD/MM/YYYY'),
        case when v_group.league_auto_renew then ' y arranca un ciclo nuevo' else '' end
      ),
      p_group_id => p_group_id, p_category => 'group_activity'
    );
  end if;

  return v_cycle;
end;
$$;

create or replace function admin_cancel_league_cycle_early_close(p_group_id uuid)
returns league_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_recipient_ids uuid[];
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can cancel an early close';
  end if;

  select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running' for update;
  if not found or not v_cycle.closed_early then
    raise exception 'this league cycle is not scheduled to close early';
  end if;
  if now() >= v_cycle.ends_at then
    raise exception 'the closing week is over; the cycle can no longer be reopened';
  end if;

  update league_cycles
    set ends_at = original_ends_at, original_ends_at = null, closed_early = false
    where id = v_cycle.id
    returning * into v_cycle;

  select array_agg(user_id) into v_recipient_ids
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Cierre anticipado cancelado',
      format(
        'El ciclo #%s sigue su curso y cierra el domingo %s.',
        v_cycle.cycle_number, to_char((v_cycle.ends_at at time zone v_group.timezone)::date, 'DD/MM/YYYY')
      ),
      p_group_id => p_group_id, p_category => 'group_activity'
    );
  end if;

  return v_cycle;
end;
$$;


-- ---- run_weekly_evaluation: reproduces 0082; adds the pre-start-days-are-excused rule ----
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
  v_local_dow int;
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
  v_cycle_start_date date;
  v_excused_penalty int;
begin
  for v_group in select * from groups loop
    v_local_hour := extract(hour from (now() at time zone v_group.timezone))::int;
    v_local_dow := extract(isodow from (now() at time zone v_group.timezone))::int; -- 1 = Monday .. 7 = Sunday
    if v_local_hour <> 8 or v_local_dow <> 1 then
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

    -- A league cycle that started MID-week snaps to that week's Monday; the days of
    -- the week before its real start day count as excused for everyone.
    v_cycle_start_date := null;
    select effective_start_date into v_cycle_start_date
      from league_cycles
      where group_id = v_group.id and status in ('running', 'completed')
        and (started_at at time zone v_group.timezone)::date = v_week_start
        and effective_start_date > v_week_start
      order by cycle_number desc
      limit 1;

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

      v_excused_penalty := v_excused;
      if v_cycle_start_date is not null then
        v_excused := v_excused + greatest(0, v_cycle_start_date - greatest(v_week_start, v_activated_date));
        v_excused_penalty := v_excused_penalty + greatest(0, v_cycle_start_date - greatest(v_week_start, v_penalty_start_date));
      end if;

      v_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_activated_date)) + 1));
      v_required := least(v_group.min_days_per_week, v_days_present);
      v_effective_required := greatest(v_required - v_excused, 0);
      v_failed := greatest(v_effective_required - v_completed, 0);

      v_penalty_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_penalty_start_date)) + 1));
      v_penalty_required := least(v_group.min_days_per_week, v_penalty_days_present);
      v_effective_penalty_required := greatest(v_penalty_required - v_excused_penalty, 0);
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

-- ---- evaluate_due_league_cycle: reproduces 0104; group-timezone dates + auto-renew ----
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
  v_eligible_count int;
  v_descenso_active boolean;
  v_descenso_cutoff int;
  v_total_descenso numeric(12, 2) := 0;
  v_amount_to_fund numeric(12, 2);
  v_descenso_user_id uuid;
  v_descenso_user_ids uuid[];
  v_winner_user_ids uuid[];
  v_winner_places int[];
  v_winner_percents numeric[];
  v_winner_idx int;
  v_cycle_start_date date;
  v_cycle_end_date date;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.payout_mode = 'cooperative' then
    return;
  end if;

  select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running' for update;
  if not found then
    return;
  end if;

  -- Dates in the GROUP's timezone (a bare ::date would use the session's UTC).
  v_cycle_start_date := (v_cycle.started_at at time zone v_group.timezone)::date;
  v_cycle_end_date := (v_cycle.ends_at at time zone v_group.timezone)::date;
  if v_cycle_end_date > p_as_of_week_end then
    return;
  end if;

  perform 1 from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge')
    for update;

  select coalesce(sum(balance), 0) into v_pool_total
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

  v_pool_for_league := greatest(v_pool_total * v_cycle.league_share_percent / 100, 0);
  v_prize_len := jsonb_array_length(v_cycle.prize_splits);

  select count(*) into v_eligible_count
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');
  v_descenso_active := v_group.payout_mode = 'league' and v_group.descenso_rank_count > 0;
  v_descenso_cutoff := case when v_descenso_active
    then greatest(v_eligible_count - v_group.descenso_rank_count, 0)
    else null
  end;

  for v_rank_group in
    with per_user as (
      select wer.user_id, sum(wer.completed_days) as completed, sum(wer.failed_days) as failed
        from weekly_evaluation_results wer
        join weekly_evaluation_runs wr on wr.id = wer.run_id
        where wer.group_id = p_group_id
          and wr.week_start_date >= v_cycle_start_date
          and wr.week_end_date <= v_cycle_end_date
        group by wer.user_id
    ),
    per_user_minutes as (
      select c.user_id, sum(c.workout_minutes) as minutes
        from checkins c
        where c.group_id = p_group_id
          and c.checkin_date >= v_cycle_start_date
          and c.checkin_date <= v_cycle_end_date
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
    -- Without descenso this is the same short-circuit as before (nothing
    -- past the prize list matters). With descenso active, every rank group
    -- has to be visited to reach the bottom N at the tail of the ranking.
    exit when v_rank_group.place > v_prize_len and not v_descenso_active;

    -- Prize winners: buffer, don't pay yet — the amount depends on the pool
    -- after descenso is folded in below, which isn't known until the scan
    -- finishes.
    if v_rank_group.place <= v_prize_len then
      v_merged_percent := 0;
      for v_split_idx in v_rank_group.place .. least(v_rank_group.place + v_rank_group.k - 1, v_prize_len) loop
        v_merged_percent := v_merged_percent + (v_cycle.prize_splits ->> (v_split_idx - 1))::numeric;
      end loop;
      v_merged_percent := v_merged_percent / v_rank_group.k;

      foreach v_winner_user_id in array v_rank_group.users loop
        v_winner_user_ids := array_append(v_winner_user_ids, v_winner_user_id);
        v_winner_places := array_append(v_winner_places, v_rank_group.place);
        v_winner_percents := array_append(v_winner_percents, v_merged_percent);
      end loop;
    end if;

    -- Descenso: the bottom descenso_rank_count places. Charged immediately
    -- (fixed amount, doesn't depend on the pool) and unconditionally even at
    -- $0, so there's always an audit trail of who was marked whether or not
    -- it actually cost them anything.
    if v_descenso_active and v_rank_group.place > v_descenso_cutoff then
      foreach v_descenso_user_id in array v_rank_group.users loop
        insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
          values (
            p_group_id, v_descenso_user_id, 'penalty', -v_group.descenso_penalty_amount, 'confirmed',
            format('descenso de liga: puesto %s', v_rank_group.place), now()
          );
        v_total_descenso := v_total_descenso + v_group.descenso_penalty_amount;
        v_descenso_user_ids := array_append(v_descenso_user_ids, v_descenso_user_id);
      end loop;
    end if;
  end loop;

  -- Boost this cycle's pool with whatever descenso collected, then resolve
  -- the buffered prize winners against the now-boosted pool.
  v_pool_for_league := v_pool_for_league + v_total_descenso;

  for v_winner_idx in 1 .. coalesce(array_length(v_winner_user_ids, 1), 0) loop
    v_winner_amount := round(v_pool_for_league * v_winner_percents[v_winner_idx] / 100, 2);
    if v_winner_amount > 0 then
      insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
        values (
          p_group_id, v_winner_user_ids[v_winner_idx], 'payout', v_winner_amount, 'confirmed',
          format('premio de liga: puesto %s (%s%%)', v_winner_places[v_winner_idx], v_winner_percents[v_winner_idx]), now()
        ) returning id into v_wtx_id;

      insert into league_cycle_payouts (cycle_id, user_id, place, share_percent, amount, wallet_transaction_id)
        values (
          v_cycle.id, v_winner_user_ids[v_winner_idx], v_winner_places[v_winner_idx],
          v_winner_percents[v_winner_idx], v_winner_amount, v_wtx_id
        );

      v_total_distributed := v_total_distributed + v_winner_amount;
    end if;
  end loop;

  -- Fund the prize: spread the cost equally across every currently active
  -- member, including the winners themselves — exactly how a shared pot
  -- works (everyone funds the prize equally, winners additionally collect).
  -- Descenso money already collected funds part (or all) of it, so only the
  -- remainder gets spread across the group — this is what keeps relegated
  -- members from being charged twice and non-relegated members' funding
  -- share unaffected by descenso.
  if v_total_distributed > 0 then
    v_amount_to_fund := greatest(v_total_distributed - v_total_descenso, 0);

    if v_amount_to_fund > 0 then
      select count(*) into v_active_count
        from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

      v_delta_cents := round(-v_amount_to_fund * 100);
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
  end if;

  update league_cycles
    set status = 'completed', completed_at = now(), pool_at_payout = v_pool_for_league
    where id = v_cycle.id;

  perform send_push_notification(
    (select array_agg(user_id) from group_members where group_id = p_group_id and status in ('active', 'needs_recharge')),
    'Ciclo de Liga terminado', 'Se repartió el premio del ciclo de Liga — revisa Reglas para ver los resultados.',
    p_group_id => p_group_id, p_category => 'money'
  );

  if v_descenso_user_ids is not null and array_length(v_descenso_user_ids, 1) > 0 then
    perform send_push_notification(
      v_descenso_user_ids,
      'Zona de descenso',
      case
        when v_group.descenso_penalty_amount > 0 then
          format('Quedaste entre los últimos del ciclo de liga y se te cobró %s de multa.', v_group.descenso_penalty_amount)
        else
          'Quedaste entre los últimos del ciclo de liga.'
      end,
      p_group_id => p_group_id, p_category => 'money'
    );
  end if;

  if v_group.league_auto_renew then
    -- The next cycle begins right away, on the Monday that follows the week just closed.
    perform start_league_cycle_at(p_group_id, ((p_as_of_week_end + 1)::timestamp) at time zone v_group.timezone);
  elsif v_group.admin_id is not null then
    perform send_push_notification(
      array[v_group.admin_id], 'Inicia un nuevo ciclo de Liga',
      'El ciclo anterior terminó y el premio ya se repartió. Puedes iniciar el próximo ciclo desde Reglas.',
      p_group_id => p_group_id, p_category => 'admin_actions'
    );
  end if;
end;
$$;

-- ---- apply_rule_proposal / apply_rule_change_direct: reproduce 0124; accept league_auto_renew ----
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
        league_duration_weeks = coalesce(
          (v_proposal.proposed_changes ->> 'league_duration_weeks')::int,
          case when v_proposal.proposed_changes ? 'league_duration_months'
            then greatest(1, round((v_proposal.proposed_changes ->> 'league_duration_months')::numeric * 52 / 12)::int)
          end,
          g.league_duration_weeks
        ),
        league_prize_splits = coalesce(v_proposal.proposed_changes -> 'league_prize_splits', g.league_prize_splits),
        mixed_league_share_percent = coalesce((v_proposal.proposed_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent),
        descenso_rank_count = coalesce((v_proposal.proposed_changes ->> 'descenso_rank_count')::int, g.descenso_rank_count),
        descenso_penalty_amount = coalesce((v_proposal.proposed_changes ->> 'descenso_penalty_amount')::numeric, g.descenso_penalty_amount),
        league_auto_renew = coalesce((v_proposal.proposed_changes ->> 'league_auto_renew')::boolean, g.league_auto_renew)
        -- enrollment_fee_amount deliberately excluded — see 0106's header comment.
    where g.id = v_proposal.group_id;

  if v_old_mode in ('league', 'mixed') and (v_proposal.proposed_changes ->> 'payout_mode') = 'cooperative' then
    update league_cycles set status = 'cancelled', completed_at = now()
      where group_id = v_proposal.group_id and status = 'running';
  end if;

  if v_proposal.proposed_changes ? 'league_cycle_started_at' then
    perform set_running_league_cycle_start(
      v_proposal.group_id, (v_proposal.proposed_changes ->> 'league_cycle_started_at')::date
    );
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
        league_duration_weeks = coalesce(
          (p_changes ->> 'league_duration_weeks')::int,
          case when p_changes ? 'league_duration_months'
            then greatest(1, round((p_changes ->> 'league_duration_months')::numeric * 52 / 12)::int)
          end,
          g.league_duration_weeks
        ),
        league_prize_splits = coalesce(p_changes -> 'league_prize_splits', g.league_prize_splits),
        mixed_league_share_percent = coalesce((p_changes ->> 'mixed_league_share_percent')::numeric, g.mixed_league_share_percent),
        descenso_rank_count = coalesce((p_changes ->> 'descenso_rank_count')::int, g.descenso_rank_count),
        descenso_penalty_amount = coalesce((p_changes ->> 'descenso_penalty_amount')::numeric, g.descenso_penalty_amount),
        league_auto_renew = coalesce((p_changes ->> 'league_auto_renew')::boolean, g.league_auto_renew),
        enrollment_fee_amount = coalesce((p_changes ->> 'enrollment_fee_amount')::numeric, g.enrollment_fee_amount)
    where g.id = p_group_id
    returning * into v_group;

  if not found then
    raise exception 'group not found';
  end if;

  if v_old_mode in ('league', 'mixed') and (p_changes ->> 'payout_mode') = 'cooperative' then
    update league_cycles set status = 'cancelled', completed_at = now()
      where group_id = p_group_id and status = 'running';
  end if;

  if p_changes ? 'league_cycle_started_at' then
    perform set_running_league_cycle_start(p_group_id, (p_changes ->> 'league_cycle_started_at')::date);
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

-- ---- create_group: one more trailing param (league_auto_renew, default false) ----
-- New signature = new overload, so the 21-arg one from 0124 is dropped first. A client
-- still sending the 21 named params keeps working (the new param has a default).
drop function if exists create_group(
  text, numeric, integer, numeric, numeric, numeric, integer,
  boolean, integer, text, text, integer, jsonb, numeric, date, text, boolean, integer, numeric, numeric, boolean
);

create or replace function create_group(
  p_name text,
  p_initial_deposit_amount numeric,
  p_min_days_per_week integer,
  p_penalty_amount numeric,
  p_weekly_penalty_cap numeric,
  p_exit_fee_amount numeric,
  p_exit_notice_days integer,
  p_require_checkout_photo boolean default false,
  p_min_workout_minutes integer default 0,
  p_admin_payment_info text default null::text,
  p_payout_mode text default 'cooperative'::text,
  p_league_duration_weeks integer default 13,
  p_league_prize_splits jsonb default '[60, 30, 10]'::jsonb,
  p_mixed_league_share_percent numeric default 50,
  p_game_starts_at date default null::date,
  p_timezone text default 'America/Bogota'::text,
  p_is_public boolean default false,
  p_descenso_rank_count integer default 0,
  p_descenso_penalty_amount numeric default 0,
  p_enrollment_fee_amount numeric default 0,
  p_admin_participates boolean default true,
  p_league_auto_renew boolean default false
)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_game_starts_at timestamptz;
  v_is_platform_admin boolean;
  v_credits int;
begin
  select is_platform_admin, group_creation_credits into v_is_platform_admin, v_credits
    from profiles where id = auth.uid();

  if not coalesce(v_is_platform_admin, false) and coalesce(v_credits, 0) <= 0 then
    raise exception 'No tienes créditos disponibles para crear un grupo.';
  end if;

  if p_is_public and not coalesce(v_is_platform_admin, false) then
    raise exception 'only the platform admin can create a public group';
  end if;

  v_game_starts_at := case when p_game_starts_at is not null then (p_game_starts_at::timestamp) at time zone p_timezone else null end;

  insert into groups (
    name, invite_code, admin_id, initial_deposit_amount, min_days_per_week,
    penalty_amount, weekly_penalty_cap, exit_fee_amount, exit_notice_days,
    require_checkout_photo, min_workout_minutes, admin_payment_info,
    payout_mode, league_duration_weeks, league_prize_splits, mixed_league_share_percent,
    game_starts_at, timezone, is_public, descenso_rank_count, descenso_penalty_amount,
    enrollment_fee_amount, league_auto_renew
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days,
    p_require_checkout_photo, p_min_workout_minutes, p_admin_payment_info,
    p_payout_mode, p_league_duration_weeks, p_league_prize_splits, p_mixed_league_share_percent,
    v_game_starts_at, p_timezone, p_is_public, p_descenso_rank_count, p_descenso_penalty_amount,
    p_enrollment_fee_amount, p_league_auto_renew
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', case when p_admin_participates then 'pending_deposit' else 'admin_only' end);

  if p_payout_mode in ('league', 'mixed') then
    perform start_league_cycle_at(v_group.id, coalesce(v_game_starts_at, now()));
  end if;

  if not coalesce(v_is_platform_admin, false) then
    update profiles set group_creation_credits = group_creation_credits - 1 where id = auth.uid();
  end if;

  return v_group;
end;
$$;
