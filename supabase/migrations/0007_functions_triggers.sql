-- ============================================================================
-- Helper predicates used throughout RLS policies.
-- security definer + stable: safe to call from a policy without recursive
-- RLS evaluation on group_members itself.
-- ============================================================================
create or replace function is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id
      and user_id = auth.uid()
      and status in ('pending_deposit', 'active', 'needs_recharge')
  );
$$;

create or replace function is_group_admin(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = p_group_id
      and user_id = auth.uid()
      and role = 'admin'
      and status in ('pending_deposit', 'active', 'needs_recharge')
  );
$$;

-- Voting/majority-count population: fully onboarded members only.
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
      and status in ('active', 'needs_recharge')
  );
$$;

-- ============================================================================
-- Invite codes: 8 chars, uppercase, excludes visually ambiguous characters.
-- ============================================================================
create or replace function generate_invite_code()
returns text
language plpgsql
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_exists boolean;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, (floor(random() * length(v_alphabet)) + 1)::int, 1);
    end loop;
    select exists (select 1 from groups where invite_code = v_code) into v_exists;
    exit when not v_exists;
  end loop;
  return v_code;
end;
$$;

-- ============================================================================
-- checkins: the date a check-in counts for is always derived on the server
-- from captured_at, never trusted from the client. A capture whose reported
-- moment drifts more than 10 minutes from server time is rejected outright,
-- since the whole point of captured_at is to prove *when* the photo was taken.
-- ============================================================================
create or replace function set_checkin_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if abs(extract(epoch from (now() - new.captured_at))) > 600 then
    raise exception 'captured_at is too far from server time (clock drift guard)';
  end if;
  new.checkin_date := (new.captured_at at time zone 'America/Bogota')::date;
  return new;
end;
$$;

create trigger trg_checkin_date
  before insert on checkins
  for each row execute function set_checkin_date();

-- ============================================================================
-- vacation_days: enforce the per-month cap set on the group.
-- ============================================================================
create or replace function check_vacation_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_used int;
begin
  select vacation_days_per_month into v_limit from groups where id = new.group_id;
  select count(*) into v_used
    from vacation_days
    where group_id = new.group_id
      and user_id = new.user_id
      and date_trunc('month', vacation_date) = date_trunc('month', new.vacation_date);
  if v_used >= v_limit then
    raise exception 'vacation day cap reached for this month';
  end if;
  return new;
end;
$$;

create trigger trg_vacation_cap
  before insert on vacation_days
  for each row execute function check_vacation_cap();

-- ============================================================================
-- wallet_transactions: the ONLY place group_members.balance is mutated.
-- Fires when a transaction is inserted already-confirmed (system penalties,
-- admin-recorded cash) or transitions from pending to confirmed.
-- ============================================================================
-- security definer: this fires on a direct client UPDATE (admin confirming a
-- transaction), which runs as the admin's own restricted role, so it needs
-- elevated rights to touch group_members.balance (a column normal clients
-- have no direct grant on — see 0009).
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
          end
      where group_id = new.group_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger trg_wallet_effect
  after insert or update of status on wallet_transactions
  for each row execute function apply_wallet_transaction_effect();

-- Auto-stamp who/when confirmed a transaction; clients cannot spoof this
-- because confirmed_by/confirmed_at are overwritten server-side regardless
-- of what the UPDATE statement supplied.
-- security definer: writes confirmed_by/confirmed_at, columns normal clients
-- have no direct grant on, so a spoofed value in the client's UPDATE payload
-- is always overwritten here rather than merely "allowed to be honest".
create or replace function stamp_wallet_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('confirmed', 'rejected') and old.status = 'pending' then
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_wallet_stamp
  before update of status on wallet_transactions
  for each row execute function stamp_wallet_confirmation();

-- ============================================================================
-- rule_votes: recompute the tally after every vote and resolve early once a
-- majority is mathematically settled (yes-majority reached, or no-majority
-- now impossible). Ties/unresolved votes are left pending for the hourly
-- timeout job (0009) to close.
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
          effective_at = (
            (date_trunc('week', (now() at time zone 'America/Bogota')) + interval '1 week')
              at time zone 'America/Bogota'
          )
      where id = v_proposal_id;
  elsif v_no > (v_proposal.member_count_snapshot - v_proposal.required_votes) then
    update rule_proposals
      set status = 'rejected', decided_at = now()
      where id = v_proposal_id;
  end if;

  return null;
end;
$$;

create trigger trg_resolve_rule_proposal
  after insert or update on rule_votes
  for each row execute function resolve_rule_proposal();

-- ============================================================================
-- Hourly safety net: any proposal whose voting window lapsed without a
-- mathematically-forced outcome is closed here. Ties/insufficient turnout
-- default to rejected (status quo wins) — documented product decision.
-- ============================================================================
create or replace function close_expired_proposals()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update rule_proposals
    set status = case when
        (select count(*) from rule_votes v where v.proposal_id = rule_proposals.id and v.vote = 'yes')
        >= required_votes
      then 'approved' else 'rejected' end,
        decided_at = now(),
        effective_at = case when
        (select count(*) from rule_votes v where v.proposal_id = rule_proposals.id and v.vote = 'yes')
        >= required_votes
      then (
        (date_trunc('week', (now() at time zone 'America/Bogota')) + interval '1 week')
          at time zone 'America/Bogota'
      ) else null end
    where status = 'pending' and voting_closes_at <= now();
end;
$$;
