-- ============================================================================
-- Lets a rule proposal specify, as part of what the group votes on, whether
-- an approved change takes effect immediately (as soon as the vote is won)
-- or on the following Monday (today's existing behavior — grade the current
-- week under the old rules first). Default false preserves current behavior
-- for any in-flight proposal.
-- ============================================================================
alter table rule_proposals add column apply_immediately boolean not null default false;

-- ============================================================================
-- apply_rule_proposal: the single place that actually copies a proposal's
-- proposed_changes onto groups. Shared by the immediate-apply path (called
-- right from the vote-resolution triggers below) and the deferred path
-- (called from run_weekly_evaluation's Monday sweep) so the two never drift.
-- No-ops if already applied (defends against being invoked twice for the
-- same proposal from two different paths).
-- ============================================================================
create or replace function apply_rule_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal rule_proposals%rowtype;
begin
  select * into v_proposal from rule_proposals where id = p_proposal_id for update;
  if not found or v_proposal.applied_at is not null then
    return;
  end if;

  update groups g
    set min_days_per_week = coalesce((v_proposal.proposed_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
        penalty_amount = coalesce((v_proposal.proposed_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
        weekly_penalty_cap = coalesce((v_proposal.proposed_changes ->> 'weekly_penalty_cap')::numeric, g.weekly_penalty_cap),
        exit_fee_amount = coalesce((v_proposal.proposed_changes ->> 'exit_fee_amount')::numeric, g.exit_fee_amount),
        exit_notice_days = coalesce((v_proposal.proposed_changes ->> 'exit_notice_days')::int, g.exit_notice_days)
    where g.id = v_proposal.group_id;

  update rule_proposals set status = 'applied', applied_at = now() where id = p_proposal_id;
end;
$$;

-- ============================================================================
-- resolve_rule_proposal: same early-majority logic as before, but an
-- apply_immediately proposal is applied the instant it wins (effective_at
-- and applied_at both become "now"), instead of waiting for next Monday.
-- ============================================================================
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
begin
  select * into v_proposal from rule_proposals where id = v_proposal_id for update;
  if v_proposal.status <> 'pending' then
    return null;
  end if;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from rule_votes where proposal_id = v_proposal_id;

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

    if v_proposal.apply_immediately then
      perform apply_rule_proposal(v_proposal_id);
    end if;
  elsif v_no > (v_proposal.member_count_snapshot - v_proposal.required_votes) then
    update rule_proposals
      set status = 'rejected', decided_at = now()
      where id = v_proposal_id;
  end if;

  return null;
end;
$$;

-- ============================================================================
-- close_expired_proposals: hourly timeout sweep, same apply_immediately
-- handling as the trigger above.
-- ============================================================================
create or replace function close_expired_proposals()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal record;
  v_yes int;
begin
  for v_proposal in
    select * from rule_proposals
      where status = 'pending' and voting_closes_at <= now()
      for update
  loop
    select count(*) filter (where vote = 'yes') into v_yes
      from rule_votes where proposal_id = v_proposal.id;

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

      if v_proposal.apply_immediately then
        perform apply_rule_proposal(v_proposal.id);
      end if;
    else
      update rule_proposals set status = 'rejected', decided_at = now() where id = v_proposal.id;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- run_weekly_evaluation: the deferred-apply tail now delegates to
-- apply_rule_proposal() instead of duplicating the column-copy logic inline.
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
        insert into wallet_transactions (
          group_id, user_id, type, amount, status, weekly_evaluation_result_id, confirmed_at
        ) values (
          v_group.id, v_member.user_id, 'penalty', -v_penalty, 'confirmed', v_result_id, now()
        );
      end if;
    end loop;

    -- Apply at most one due (deferred, apply_immediately=false) rule change
    -- per group per run — immediate ones were already applied at approval
    -- time and never match applied_at is null here.
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
-- propose_rule_change: new p_apply_immediately parameter (signature change,
-- so the old 2-arg overload must be dropped explicitly first).
-- ============================================================================
drop function if exists propose_rule_change(uuid, jsonb);

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

  return v_proposal;
exception
  when unique_violation then
    raise exception 'this group already has an open rule vote';
end;
$$;
