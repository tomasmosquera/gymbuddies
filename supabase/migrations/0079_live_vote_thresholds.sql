-- ============================================================================
-- "Necesitas X votos" used to be two bugs in one:
--
-- 1. required_votes/member_count_snapshot were frozen the moment a vote
--    opened (send_excuse_request_to_vote / propose_rule_change) and never
--    revisited, even if members left the group afterward.
-- 2. The count feeding that snapshot never checked activation date — a
--    member whose activated_at is still in the future (set via a group's
--    game_starts_at at creation) got counted as an already-playing voter.
--
-- Both bugs landed on the same real vote: a 5-person group had an excuse
-- vote asking for 4 yes votes, because at open time 2 of the "7 active"
-- members had a September activation date and hadn't started playing yet.
--
-- Fix: required_votes/member_count_snapshot are now derived from
-- count_eligible_voters() (mirrors is_active_participant's own predicate —
-- active/needs_recharge AND already activated) and recomputed live: on
-- every vote cast, on every relevant group_members change (removal, rejoin,
-- activation date edit), and again at the 72h timeout. The columns are kept
-- in sync on every recompute so the "necesitas X votos" the client already
-- reads straight off the row stays correct without any client change.
-- ============================================================================

create or replace function count_eligible_voters(p_group_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from group_members
    where group_id = p_group_id
      and status in ('active', 'needs_recharge')
      and coalesce(activated_at, joined_at) <= now();
$$;

create or replace function majority_threshold(p_count integer)
returns integer
language sql
immutable
as $$
  select floor(p_count / 2.0)::int + 1;
$$;

-- ============================================================================
-- Excuse votes
-- ============================================================================

create or replace function try_resolve_excuse_vote(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_member_count int;
  v_required int;
  v_yes int;
  v_no int;
begin
  select * into v_request from excuse_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' or v_request.voting_closes_at is null then
    return;
  end if;

  v_member_count := count_eligible_voters(v_request.group_id);
  v_required := majority_threshold(v_member_count);

  update excuse_requests
    set required_votes = v_required, member_count_snapshot = v_member_count
    where id = p_request_id;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from excuse_votes where excuse_request_id = p_request_id;

  if v_yes >= v_required then
    update excuse_requests set status = 'approved', decided_at = now() where id = p_request_id;
    insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
      select p_request_id, v_request.group_id, v_request.user_id, d::date
      from generate_series(v_request.requested_start_date, v_request.requested_end_date, interval '1 day') as d
    on conflict (group_id, user_id, excused_date) do nothing;
    perform send_push_notification(
      array[v_request.user_id], 'Tu excusa fue aprobada', 'El grupo votó a favor de tu solicitud de excusa.',
      p_group_id => v_request.group_id, p_category => 'votes'
    );
  elsif v_no > (v_member_count - v_required) then
    update excuse_requests set status = 'rejected', decided_at = now() where id = p_request_id;
    perform send_push_notification(
      array[v_request.user_id], 'Tu excusa fue rechazada', 'El grupo votó en contra de tu solicitud de excusa.',
      p_group_id => v_request.group_id, p_category => 'votes'
    );
  end if;
end;
$$;

create or replace function resolve_excuse_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform try_resolve_excuse_vote(coalesce(new.excuse_request_id, old.excuse_request_id));
  return null;
end;
$$;

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
  v_yes int;
begin
  for v_request in
    select * from excuse_requests
      where status = 'pending' and voting_closes_at is not null and voting_closes_at <= now()
      for update
  loop
    v_member_count := count_eligible_voters(v_request.group_id);
    v_required := majority_threshold(v_member_count);

    select count(*) filter (where vote = 'yes') into v_yes
      from excuse_votes where excuse_request_id = v_request.id;

    if v_yes >= v_required then
      update excuse_requests
        set status = 'approved', decided_at = now(), required_votes = v_required, member_count_snapshot = v_member_count
        where id = v_request.id;
      insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
        select v_request.id, v_request.group_id, v_request.user_id, d::date
        from generate_series(v_request.requested_start_date, v_request.requested_end_date, interval '1 day') as d
      on conflict (group_id, user_id, excused_date) do nothing;
      perform send_push_notification(
        array[v_request.user_id], 'Tu excusa fue aprobada', 'El grupo votó a favor de tu solicitud de excusa.',
        p_group_id => v_request.group_id, p_category => 'votes'
      );
    else
      update excuse_requests
        set status = 'rejected', decided_at = now(), required_votes = v_required, member_count_snapshot = v_member_count
        where id = v_request.id;
      perform send_push_notification(
        array[v_request.user_id], 'Tu excusa fue rechazada', 'El grupo votó en contra de tu solicitud de excusa.',
        p_group_id => v_request.group_id, p_category => 'votes'
      );
    end if;
  end loop;
end;
$$;

create or replace function send_excuse_request_to_vote(p_request_id uuid)
returns excuse_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request excuse_requests%rowtype;
  v_member_count int;
  v_recipient_ids uuid[];
begin
  select * into v_request from excuse_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'this request is not open';
  end if;
  if v_request.voting_closes_at is not null then
    raise exception 'this request is already in a group vote';
  end if;
  if not is_group_admin(v_request.group_id) then
    raise exception 'only the group admin can send this to a group vote';
  end if;

  v_member_count := count_eligible_voters(v_request.group_id);
  if v_member_count < 1 then
    raise exception 'no active members to vote yet';
  end if;

  update excuse_requests
    set required_votes = majority_threshold(v_member_count),
        member_count_snapshot = v_member_count,
        voting_closes_at = now() + interval '72 hours'
    where id = p_request_id
    returning * into v_request;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = v_request.group_id and status in ('active', 'needs_recharge') and user_id <> v_request.user_id;
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva votación de excusa', 'El administrador puso una solicitud de excusa a votación del grupo.',
      p_group_id => v_request.group_id, p_category => 'votes'
    );
  end if;

  perform send_push_notification(
    array[v_request.user_id], 'Tu excusa está en votación',
    'El administrador puso tu solicitud de excusa a votación del grupo.',
    p_group_id => v_request.group_id, p_category => 'votes'
  );

  return v_request;
exception
  when unique_violation then
    raise exception 'this group already has an open excuse vote';
end;
$$;

-- ============================================================================
-- Rule proposals
-- ============================================================================

create or replace function try_resolve_rule_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal rule_proposals%rowtype;
  v_member_count int;
  v_required int;
  v_yes int;
  v_no int;
  v_recipient_ids uuid[];
  v_tz text;
begin
  select * into v_proposal from rule_proposals where id = p_proposal_id for update;
  if not found or v_proposal.status <> 'pending' then
    return;
  end if;

  v_member_count := count_eligible_voters(v_proposal.group_id);
  v_required := majority_threshold(v_member_count);

  update rule_proposals
    set required_votes = v_required, member_count_snapshot = v_member_count
    where id = p_proposal_id;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from rule_votes where proposal_id = p_proposal_id;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = v_proposal.group_id and status in ('active', 'needs_recharge');

  if v_yes >= v_required then
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
      where id = p_proposal_id;

    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Propuesta aprobada',
        case when v_proposal.apply_immediately
          then 'La propuesta de regla fue aprobada y ya está vigente.'
          else 'La propuesta de regla fue aprobada — aplica desde el próximo lunes.'
        end,
        p_group_id => v_proposal.group_id, p_category => 'votes'
      );
    end if;

    if v_proposal.apply_immediately then
      perform apply_rule_proposal(p_proposal_id);
    end if;
  elsif v_no > (v_member_count - v_required) then
    update rule_proposals set status = 'rejected', decided_at = now() where id = p_proposal_id;

    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Propuesta rechazada', 'La propuesta de regla fue rechazada por el grupo.',
        p_group_id => v_proposal.group_id, p_category => 'votes'
      );
    end if;
  end if;
end;
$$;

create or replace function resolve_rule_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform try_resolve_rule_proposal(coalesce(new.proposal_id, old.proposal_id));
  return null;
end;
$$;

create or replace function close_expired_proposals()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal record;
  v_member_count int;
  v_required int;
  v_yes int;
  v_recipient_ids uuid[];
  v_tz text;
begin
  for v_proposal in
    select * from rule_proposals
      where status = 'pending' and voting_closes_at <= now()
      for update
  loop
    v_member_count := count_eligible_voters(v_proposal.group_id);
    v_required := majority_threshold(v_member_count);

    select count(*) filter (where vote = 'yes') into v_yes
      from rule_votes where proposal_id = v_proposal.id;

    select array_agg(user_id) into v_recipient_ids
      from group_members
      where group_id = v_proposal.group_id and status in ('active', 'needs_recharge');

    if v_yes >= v_required then
      select timezone into v_tz from groups where id = v_proposal.group_id;
      update rule_proposals
        set status = 'approved',
            decided_at = now(),
            required_votes = v_required,
            member_count_snapshot = v_member_count,
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
          case when v_proposal.apply_immediately
            then 'La propuesta de regla fue aprobada y ya está vigente.'
            else 'La propuesta de regla fue aprobada — aplica desde el próximo lunes.'
          end,
          p_group_id => v_proposal.group_id, p_category => 'votes'
        );
      end if;

      if v_proposal.apply_immediately then
        perform apply_rule_proposal(v_proposal.id);
      end if;
    else
      update rule_proposals
        set status = 'rejected', decided_at = now(), required_votes = v_required, member_count_snapshot = v_member_count
        where id = v_proposal.id;

      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Propuesta rechazada', 'La propuesta de regla fue rechazada por el grupo.',
          p_group_id => v_proposal.group_id, p_category => 'votes'
        );
      end if;
    end if;
  end loop;
end;
$$;

create or replace function propose_rule_change(p_group_id uuid, p_changes jsonb, p_apply_immediately boolean default false)
returns rule_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count int;
  v_proposal rule_proposals%rowtype;
  v_recipient_ids uuid[];
  v_full_name text;
begin
  if not is_active_participant(p_group_id, auth.uid()) then
    raise exception 'only active members can propose rule changes';
  end if;

  v_member_count := count_eligible_voters(p_group_id);
  if v_member_count < 1 then
    raise exception 'no active members to vote yet';
  end if;

  insert into rule_proposals (
    group_id, proposed_by, proposed_changes, required_votes,
    member_count_snapshot, voting_closes_at, apply_immediately
  ) values (
    p_group_id, auth.uid(), p_changes, majority_threshold(v_member_count),
    v_member_count, now() + interval '72 hours', p_apply_immediately
  ) returning * into v_proposal;

  select full_name into v_full_name from profiles where id = auth.uid();

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva propuesta de regla', format('%s propuso un cambio de reglas — ve a votar.', v_full_name),
      p_group_id => p_group_id, p_category => 'votes'
    );
  end if;

  return v_proposal;
exception
  when unique_violation then
    raise exception 'this group already has an open rule vote';
end;
$$;

-- ============================================================================
-- Keep open votes live as membership changes (removals, rejoins, activation
-- date edits), not just when someone casts a new vote.
-- ============================================================================

create or replace function refresh_open_votes_for_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := coalesce(new.group_id, old.group_id);
  v_id uuid;
begin
  for v_id in
    select id from excuse_requests where group_id = v_group_id and status = 'pending' and voting_closes_at is not null
  loop
    perform try_resolve_excuse_vote(v_id);
  end loop;

  for v_id in select id from rule_proposals where group_id = v_group_id and status = 'pending' loop
    perform try_resolve_rule_proposal(v_id);
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_refresh_open_votes on group_members;
create trigger trg_refresh_open_votes
  after insert or update of status, activated_at or delete on group_members
  for each row
  execute function refresh_open_votes_for_group();

-- Correct any currently open vote right away, rather than waiting for the
-- next vote cast or membership change to happen to trigger a recompute.
do $$
declare
  v_id uuid;
begin
  for v_id in select id from excuse_requests where status = 'pending' and voting_closes_at is not null loop
    perform try_resolve_excuse_vote(v_id);
  end loop;
  for v_id in select id from rule_proposals where status = 'pending' loop
    perform try_resolve_rule_proposal(v_id);
  end loop;
end;
$$;
