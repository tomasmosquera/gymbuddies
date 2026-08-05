-- ============================================================================
-- Product decision: a vote (excuse or rule change) that runs out its 72h
-- window still pending — no early majority either way — now defaults to
-- APPROVED instead of rejected. The reasoning: if the group couldn't be
-- bothered to reach a decision, that's on the members who didn't vote, not
-- on the person whose excuse/proposal is waiting on them.
--
-- This only changes the *timeout* outcome. A vote that resolves early
-- during the window because a majority (or an impossible-majority) was
-- actually reached via real votes — try_resolve_excuse_vote /
-- try_resolve_rule_proposal, unchanged — is a genuine decision by the
-- group and keeps working exactly as before.
--
-- Also adds a "1 hour left" reminder push to whoever hasn't voted yet
-- (excluding the requester/proposer, same as the "vote opened" notification
-- already does), telling them a no-show now means an automatic yes.
-- ============================================================================

alter table excuse_requests add column if not exists reminder_sent_at timestamptz;
alter table rule_proposals add column if not exists reminder_sent_at timestamptz;

-- ============================================================================
-- Excuse votes: approve unconditionally on timeout.
-- ============================================================================

create or replace function close_expired_excuse_votes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_member_count int;
  v_required int;
begin
  for v_request in
    select * from excuse_requests
      where status = 'pending' and voting_closes_at is not null and voting_closes_at <= now()
      for update
  loop
    v_member_count := count_eligible_voters(v_request.group_id);
    v_required := majority_threshold(v_member_count);

    update excuse_requests
      set status = 'approved', decided_at = now(), required_votes = v_required, member_count_snapshot = v_member_count
      where id = v_request.id;
    insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
      select v_request.id, v_request.group_id, v_request.user_id, d::date
      from generate_series(v_request.requested_start_date, v_request.requested_end_date, interval '1 day') as d
    on conflict (group_id, user_id, excused_date) do nothing;
    perform send_push_notification(
      array[v_request.user_id], 'Tu excusa fue aprobada',
      'El plazo de votación terminó sin que el grupo llegara a una decisión — tu excusa quedó aprobada por defecto.',
      p_group_id => v_request.group_id, p_category => 'votes'
    );
  end loop;
end;
$$;

-- ============================================================================
-- Rule proposals: approve unconditionally on timeout.
-- ============================================================================

create or replace function close_expired_proposals()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal record;
  v_recipient_ids uuid[];
  v_tz text;
begin
  for v_proposal in
    select * from rule_proposals
      where status = 'pending' and voting_closes_at <= now()
      for update
  loop
    select array_agg(user_id) into v_recipient_ids
      from group_members
      where group_id = v_proposal.group_id and status in ('active', 'needs_recharge');

    select timezone into v_tz from groups where id = v_proposal.group_id;
    update rule_proposals
      set status = 'approved',
          decided_at = now(),
          effective_at = case
            when v_proposal.apply_immediately then now()
            else (
              (date_trunc('week', (now() at time zone v_tz)) + interval '1 week')
                at time zone v_tz
            )
          end
      where id = v_proposal.id;

    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Propuesta aprobada',
        'El plazo de votación terminó sin que el grupo llegara a una decisión — la propuesta quedó aprobada por defecto.',
        p_group_id => v_proposal.group_id, p_category => 'votes'
      );
    end if;

    if v_proposal.apply_immediately then
      perform apply_rule_proposal(v_proposal.id);
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- "1 hour left, and a no-show defaults to yes" reminder for whoever in the
-- eligible-voter pool hasn't cast a vote yet. Fires once per request
-- (reminder_sent_at gate) in the 1h window before voting_closes_at.
-- ============================================================================

create or replace function send_voting_deadline_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_proposal record;
  v_recipient_ids uuid[];
begin
  for v_request in
    select * from excuse_requests
      where status = 'pending' and voting_closes_at is not null
        and voting_closes_at <= now() + interval '1 hour' and voting_closes_at > now()
        and reminder_sent_at is null
      for update
  loop
    select array_agg(gm.user_id) into v_recipient_ids
      from group_members gm
      where gm.group_id = v_request.group_id
        and gm.status in ('active', 'needs_recharge')
        and coalesce(gm.activated_at, gm.joined_at) <= now()
        and gm.user_id <> v_request.user_id
        and not exists (
          select 1 from excuse_votes ev where ev.excuse_request_id = v_request.id and ev.user_id = gm.user_id
        );

    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Última hora para votar',
        'Queda 1 hora para que cierre la votación de una excusa. Si el grupo no llega a una decisión, la excusa quedará aprobada por defecto.',
        p_group_id => v_request.group_id, p_category => 'votes'
      );
    end if;

    update excuse_requests set reminder_sent_at = now() where id = v_request.id;
  end loop;

  for v_proposal in
    select * from rule_proposals
      where status = 'pending'
        and voting_closes_at <= now() + interval '1 hour' and voting_closes_at > now()
        and reminder_sent_at is null
      for update
  loop
    select array_agg(gm.user_id) into v_recipient_ids
      from group_members gm
      where gm.group_id = v_proposal.group_id
        and gm.status in ('active', 'needs_recharge')
        and coalesce(gm.activated_at, gm.joined_at) <= now()
        and gm.user_id <> v_proposal.proposed_by
        and not exists (
          select 1 from rule_votes rv where rv.proposal_id = v_proposal.id and rv.user_id = gm.user_id
        );

    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Última hora para votar',
        'Queda 1 hora para que cierre la votación de un cambio de reglas. Si el grupo no llega a una decisión, el cambio quedará aprobado por defecto.',
        p_group_id => v_proposal.group_id, p_category => 'votes'
      );
    end if;

    update rule_proposals set reminder_sent_at = now() where id = v_proposal.id;
  end loop;
end;
$$;

select cron.schedule('voting-deadline-reminders', '*/15 * * * *', $$select send_voting_deadline_reminders();$$);
