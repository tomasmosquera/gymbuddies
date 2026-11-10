-- ============================================================================
-- admin_set_member_penalty_start_date: now also retroactively waives money
-- already charged for weeks the NEW date protects, instead of only taking
-- effect for future weekly evaluations. Before this, moving "protegido
-- hasta" earlier than an already-evaluated week left that week's charge
-- standing forever, which is exactly the bug a manual data-fix just had to
-- paper over for a real member (medical-excuse case, handled via excuse_dates
-- instead, since that one was an excuse, not a protection date).
--
-- Mirrors run_weekly_evaluation's own penalty-side formula (0136) exactly —
-- v_penalty_days_present/v_penalty_required/v_failed_for_penalty — but fed
-- the NEW p_date instead of the member's recorded penalty_start_date, for
-- every already-frozen week that formula could reduce. required_days/
-- completed_days/failed_days are never touched: those describe real
-- attendance (what the Dashboard/Ranking's consistency and GB Score read),
-- not money, and run_weekly_evaluation never let protection change them
-- either — only penalty_charged/penalty_protected and the linked
-- wallet_transactions row move.
--
-- Deliberately one-directional: only ever refunds (v_new_penalty <
-- penalty_charged), never retroactively charges more if the admin moves the
-- date LATER (less protection). Silently back-charging real money for past
-- weeks the member already saw as settled would be a much more surprising
-- action than forgiving one — if that's ever wanted, it needs its own
-- explicit admin action, not a side effect of this one.
--
-- A $0-charge week becomes a straight delete of its wallet_transactions
-- 'penalty' row (one row per weekly_evaluation_result_id, never fan-out) —
-- same "erase the mistake, don't leave an offsetting entry" shape used for
-- the medical-excuse correction, so "Multas cobradas en total" (a lifetime
-- sum over type = 'penalty') never carries a reversed charge's ghost. A
-- still-partially-charged week updates that row's amount in place instead.
-- ============================================================================
create or replace function admin_set_member_penalty_start_date(p_member_id uuid, p_date date)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
  v_group record;
  v_result record;
  v_penalty_days_present int;
  v_penalty_required int;
  v_effective_penalty_required int;
  v_failed_for_penalty int;
  v_penalty_protected boolean;
  v_new_penalty numeric(12, 2);
  v_delta numeric(12, 2);
  v_total_refund numeric(12, 2) := 0;
begin
  select * into v_member from group_members where id = p_member_id;
  if not found then
    raise exception 'member not found';
  end if;
  if not is_group_admin(v_member.group_id) then
    raise exception 'only the group admin can change a member''s penalty start date';
  end if;

  select * into v_group from groups where id = v_member.group_id;

  update group_members
    set penalty_start_date = (p_date::timestamp) at time zone v_group.timezone
    where id = p_member_id
    returning * into v_member;

  for v_result in
    select r.*, run.week_start_date, run.week_end_date
    from weekly_evaluation_results r
    join weekly_evaluation_runs run on run.id = r.run_id
    where r.group_id = v_member.group_id
      and r.user_id = v_member.user_id
      and run.week_start_date < p_date
      and r.penalty_charged > 0
    order by run.week_start_date
  loop
    v_penalty_days_present := least(7, greatest(0, (v_result.week_end_date - greatest(v_result.week_start_date, p_date)) + 1));
    v_penalty_required := least(v_group.min_days_per_week, v_penalty_days_present);
    v_effective_penalty_required := greatest(v_penalty_required - v_result.excused_days_used, 0);
    v_failed_for_penalty := greatest(v_effective_penalty_required - v_result.completed_days, 0);
    v_penalty_protected := p_date > v_result.week_start_date;
    v_new_penalty := case
      when v_group.payout_mode = 'league' then 0
      else least(v_failed_for_penalty * v_group.penalty_amount, v_group.weekly_penalty_cap)
    end;

    continue when v_new_penalty >= v_result.penalty_charged;

    v_delta := v_result.penalty_charged - v_new_penalty;

    update weekly_evaluation_results
      set penalty_charged = v_new_penalty,
          penalty_protected = v_penalty_protected,
          balance_after = balance_before - v_new_penalty
      where id = v_result.id;

    if v_new_penalty <= 0 then
      delete from wallet_transactions
        where weekly_evaluation_result_id = v_result.id and type = 'penalty';
    else
      update wallet_transactions
        set amount = -v_new_penalty
        where weekly_evaluation_result_id = v_result.id and type = 'penalty';
    end if;

    update group_members set balance = balance + v_delta where id = p_member_id;
    v_total_refund := v_total_refund + v_delta;
  end loop;

  select * into v_member from group_members where id = p_member_id;

  perform send_push_notification(
    array[v_member.user_id], 'Tu fecha de inicio de penalizaciones cambió',
    case when v_total_refund > 0 then
      format(
        'El administrador te protegió desde el %s y te devolvió %s %s en multas que ya te habían cobrado.',
        to_char(p_date, 'DD/MM/YYYY'), v_group.currency, to_char(v_total_refund, 'FM999,999,999')
      )
    else
      format('El administrador ajustó la fecha desde la que pueden penalizarte a partir del %s.', to_char(p_date, 'DD/MM/YYYY'))
    end,
    p_group_id => v_member.group_id, p_category => 'admin_actions'
  );

  return v_member;
end;
$$;
