-- ============================================================================
-- create_group: atomically creates the group and makes the caller its admin.
-- The admin is a player like everyone else and also starts pending_deposit.
-- ============================================================================
create or replace function create_group(
  p_name text,
  p_initial_deposit_amount numeric,
  p_min_days_per_week int,
  p_penalty_amount numeric,
  p_vacation_days_per_month int,
  p_admin_payment_info text default null
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
    name, invite_code, admin_id, initial_deposit_amount,
    min_days_per_week, penalty_amount, vacation_days_per_month, admin_payment_info
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount,
    p_min_days_per_week, p_penalty_amount, p_vacation_days_per_month, p_admin_payment_info
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
  values (v_group.id, auth.uid(), 'admin', 'pending_deposit');

  return v_group;
end;
$$;

-- ============================================================================
-- join_group: joins by invite code. Re-activates a previous 'left' membership
-- instead of erroring, so a returning member doesn't lose their history.
-- ============================================================================
create or replace function join_group(p_invite_code text)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_member group_members%rowtype;
begin
  select id into v_group_id from groups where invite_code = upper(p_invite_code);
  if v_group_id is null then
    raise exception 'invalid invite code';
  end if;

  select * into v_member from group_members
    where group_id = v_group_id and user_id = auth.uid();

  if found then
    if v_member.status in ('active', 'needs_recharge', 'pending_deposit') then
      raise exception 'already a member of this group';
    end if;
    update group_members
      set status = 'pending_deposit', joined_at = now()
      where id = v_member.id
      returning * into v_member;
    return v_member;
  end if;

  insert into group_members (group_id, user_id, role, status)
    values (v_group_id, auth.uid(), 'member', 'pending_deposit')
    returning * into v_member;
  return v_member;
end;
$$;

-- ============================================================================
-- leave_group: self-service. Balance is intentionally left as-is (a settled
-- ledger, not refunded) — friends reconcile any payout outside the app.
-- ============================================================================
create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update group_members
    set status = 'left'
    where group_id = p_group_id and user_id = auth.uid();
end;
$$;

-- ============================================================================
-- propose_rule_change: admin only. proposed_changes is a JSON subset of
-- {min_days_per_week, penalty_amount, vacation_days_per_month}.
-- ============================================================================
create or replace function propose_rule_change(p_group_id uuid, p_changes jsonb)
returns rule_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count int;
  v_proposal rule_proposals%rowtype;
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
    member_count_snapshot, voting_closes_at
  ) values (
    p_group_id, auth.uid(), p_changes, floor(v_member_count / 2.0)::int + 1,
    v_member_count, now() + interval '72 hours'
  ) returning * into v_proposal;

  return v_proposal;
exception
  when unique_violation then
    raise exception 'this group already has an open vote';
end;
$$;

-- ============================================================================
-- cast_vote: the only way to write rule_votes (table has no direct insert/
-- update policy for clients — see 0009). Upserts so a member can change
-- their vote before the window closes.
-- ============================================================================
create or replace function cast_vote(p_proposal_id uuid, p_vote text)
returns rule_votes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal rule_proposals%rowtype;
  v_joined_at timestamptz;
  v_vote rule_votes%rowtype;
begin
  if p_vote not in ('yes', 'no') then
    raise exception 'vote must be yes or no';
  end if;

  select * into v_proposal from rule_proposals where id = p_proposal_id;
  if not found or v_proposal.status <> 'pending' or now() >= v_proposal.voting_closes_at then
    raise exception 'this vote is not open';
  end if;

  if not is_voting_member(v_proposal.group_id, auth.uid()) then
    raise exception 'only active members can vote';
  end if;

  select joined_at into v_joined_at
    from group_members
    where group_id = v_proposal.group_id and user_id = auth.uid();

  if v_joined_at > v_proposal.created_at then
    raise exception 'members who joined after the vote opened cannot vote on it';
  end if;

  insert into rule_votes (proposal_id, user_id, vote)
    values (p_proposal_id, auth.uid(), p_vote)
    on conflict (proposal_id, user_id) do update set vote = excluded.vote, voted_at = now()
    returning * into v_vote;

  return v_vote;
end;
$$;

-- ============================================================================
-- run_weekly_evaluation: computes failed days / penalties for the week that
-- just ended, for every group, then applies any rule change that is due to
-- take effect for the week now starting. Order matters: the week just ended
-- must be graded against the rules that were actually in force during it,
-- so rule changes are applied AFTER grading, never before.
-- Idempotent per (group, week) via weekly_evaluation_runs' unique constraint.
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
  v_vacation int;
  v_required int;
  v_effective_required int;
  v_failed int;
  v_penalty numeric(12, 2);
  v_result_id uuid;
  v_run_ids uuid[] := '{}';
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
      select count(distinct checkin_date) into v_completed
        from checkins
        where group_id = v_group.id and user_id = v_member.user_id
          and checkin_date between v_week_start and v_week_end;

      select count(*) into v_vacation
        from vacation_days
        where group_id = v_group.id and user_id = v_member.user_id
          and vacation_date between v_week_start and v_week_end;

      v_required := v_group.min_days_per_week;
      v_effective_required := greatest(v_required - v_vacation, 0);
      v_failed := greatest(v_effective_required - v_completed, 0);
      v_penalty := v_failed * v_group.penalty_amount;

      insert into weekly_evaluation_results (
        run_id, group_id, user_id, required_days, completed_days,
        vacation_days_used, failed_days, penalty_charged,
        balance_before, balance_after, status_after
      ) values (
        v_run_id, v_group.id, v_member.user_id, v_required, v_completed,
        v_vacation, v_failed, v_penalty, v_member.balance,
        v_member.balance - v_penalty,
        case when v_member.balance - v_penalty <= 0 then 'needs_recharge' else 'active' end
      ) returning id into v_result_id;

      if v_penalty > 0 then
        -- trg_wallet_effect (0007) applies the balance delta and status flip.
        insert into wallet_transactions (
          group_id, user_id, type, amount, status, weekly_evaluation_result_id, confirmed_at
        ) values (
          v_group.id, v_member.user_id, 'penalty', -v_penalty, 'confirmed', v_result_id, now()
        );
      end if;
    end loop;

    -- Apply at most one due rule change per group per run (see migration
    -- comment: concurrently-approved proposals are vanishingly rare and, if
    -- it happens, the runner-up simply applies on the following run).
    update groups g
      set min_days_per_week = coalesce((p.proposed_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
          penalty_amount = coalesce((p.proposed_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
          vacation_days_per_month = coalesce((p.proposed_changes ->> 'vacation_days_per_month')::int, g.vacation_days_per_month)
      from (
        select * from rule_proposals
          where group_id = v_group.id and status = 'approved' and applied_at is null and effective_at <= now()
          order by effective_at asc, decided_at asc limit 1
      ) p
      where g.id = v_group.id and p.group_id = g.id;

    update rule_proposals
      set status = 'applied', applied_at = now()
      where id = (
        select id from rule_proposals
          where group_id = v_group.id and status = 'approved' and applied_at is null and effective_at <= now()
          order by effective_at asc, decided_at asc limit 1
      );
  end loop;

  return query select * from weekly_evaluation_runs where id = any(v_run_ids);
end;
$$;
