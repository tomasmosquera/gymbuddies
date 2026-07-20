-- ============================================================================
-- create_excuse_request: member self-service. travel/medical require proof
-- and go straight to the admin queue (no vote columns populated); other has
-- no proof requirement and opens a group vote identical in shape to
-- propose_rule_change's.
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
  else
    insert into excuse_requests (
      group_id, user_id, excuse_type, requested_start_date, requested_end_date, reason, proof_path
    ) values (
      p_group_id, auth.uid(), p_excuse_type, p_start_date, p_end_date, p_reason, p_proof_path
    ) returning * into v_request;
  end if;

  return v_request;
exception
  when unique_violation then
    raise exception 'this group already has an open "other" excuse vote';
end;
$$;

-- ============================================================================
-- approve_excuse_request: admin-only, travel/medical only. The admin picks
-- exactly which requested dates count as excused (partial credit for travel
-- is "reasonable time to train around the trip", decided case-by-case).
-- ============================================================================
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
  return v_request;
end;
$$;

-- ============================================================================
-- cast_excuse_vote: 'other' type only — mirrors cast_vote exactly.
-- ============================================================================
create or replace function cast_excuse_vote(p_request_id uuid, p_vote text)
returns excuse_votes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_joined_at timestamptz;
  v_vote excuse_votes%rowtype;
begin
  if p_vote not in ('yes', 'no') then
    raise exception 'vote must be yes or no';
  end if;

  select * into v_request from excuse_requests where id = p_request_id;
  if not found or v_request.excuse_type <> 'other' or v_request.status <> 'pending' or now() >= v_request.voting_closes_at then
    raise exception 'this vote is not open';
  end if;
  if not is_voting_member(v_request.group_id, auth.uid()) then
    raise exception 'only active members can vote';
  end if;

  select joined_at into v_joined_at from group_members
    where group_id = v_request.group_id and user_id = auth.uid();
  if v_joined_at > v_request.created_at then
    raise exception 'members who joined after the vote opened cannot vote on it';
  end if;

  insert into excuse_votes (excuse_request_id, user_id, vote)
    values (p_request_id, auth.uid(), p_vote)
    on conflict (excuse_request_id, user_id) do update set vote = excluded.vote, voted_at = now()
    returning * into v_vote;
  return v_vote;
end;
$$;

-- ============================================================================
-- resolve_excuse_vote: same early-majority logic as resolve_rule_proposal.
-- On approval, 'other' has no admin curation step — the ENTIRE requested
-- range is excused (all-or-nothing group decision, confirmed with the user).
-- ============================================================================
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
  elsif v_no > (v_request.member_count_snapshot - v_request.required_votes) then
    update excuse_requests set status = 'rejected', decided_at = now() where id = v_request_id;
  end if;

  return null;
end;
$$;

create trigger trg_resolve_excuse_vote
  after insert or update on excuse_votes
  for each row execute function resolve_excuse_vote();

-- ============================================================================
-- close_expired_excuse_votes: hourly safety net, mirrors close_expired_proposals.
-- ============================================================================
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
    else
      update excuse_requests set status = 'rejected', decided_at = now() where id = v_request.id;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- create_group / leave_group: signatures changed — must DROP the old
-- overloads first, since create-or-replace only replaces a function with the
-- SAME argument types; a different arg list would create a stale duplicate
-- overload instead of replacing anything.
-- ============================================================================
drop function if exists create_group(text, numeric, int, numeric, int, text);
drop function if exists leave_group(uuid);

create or replace function create_group(
  p_name text,
  p_initial_deposit_amount numeric,
  p_min_days_per_week int,
  p_penalty_amount numeric,
  p_weekly_penalty_cap numeric,
  p_exit_fee_amount numeric,
  p_exit_notice_days int,
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
    name, invite_code, admin_id, initial_deposit_amount, min_days_per_week,
    penalty_amount, weekly_penalty_cap, exit_fee_amount, exit_notice_days, admin_payment_info
  ) values (
    p_name, generate_invite_code(), auth.uid(), p_initial_deposit_amount, p_min_days_per_week,
    p_penalty_amount, p_weekly_penalty_cap, p_exit_fee_amount, p_exit_notice_days, p_admin_payment_info
  ) returning * into v_group;

  insert into group_members (group_id, user_id, role, status)
    values (v_group.id, auth.uid(), 'admin', 'pending_deposit');
  return v_group;
end;
$$;

-- ============================================================================
-- leave_group: p_immediate=true charges exit_fee_amount (via
-- wallet_transactions, the one balance-mutation path) and leaves now;
-- p_immediate=false starts the notice clock without changing status — the
-- member stays fully accountable (checkins/evaluation continue normally)
-- until process_scheduled_leaves flips them once leave_effective_at arrives.
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
  else
    update group_members
      set leave_requested_at = now(), leave_effective_at = now() + (v_group.exit_notice_days || ' days')::interval
      where id = v_member.id
      returning * into v_member;
  end if;

  return v_member;
end;
$$;

create or replace function cancel_leave_request(p_group_id uuid)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
begin
  update group_members
    set leave_requested_at = null, leave_effective_at = null
    where group_id = p_group_id and user_id = auth.uid() and status not in ('left', 'removed')
    returning * into v_member;
  if not found then
    raise exception 'no pending leave request to cancel';
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
begin
  update group_members
    set status = 'left', leave_requested_at = null, leave_effective_at = null
    where leave_effective_at is not null and leave_effective_at <= now()
      and status not in ('left', 'removed');
end;
$$;

-- ============================================================================
-- run_weekly_evaluation: same algorithm as the current version (0012), with
-- two changes: excused-days now come from excuse_dates instead of
-- vacation_days, and the penalty is capped at the group's weekly_penalty_cap.
-- The trailing rule-application UPDATE now covers the 3 new configurable
-- fields instead of vacation_days_per_month.
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
          weekly_penalty_cap = coalesce((p.proposed_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
          exit_fee_amount = coalesce((p.proposed_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
          exit_notice_days = coalesce((p.proposed_changes ->> 'exit_notice_days')::int, g.exit_notice_days)
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
