-- ============================================================================
-- Previously, only 'other'-type excuses could go to a group vote (opened
-- automatically at creation), while 'travel'/'medical' could only ever be
-- decided directly by the admin. Now ALL excuse types land in the admin's
-- pending queue first, and the admin chooses per-request: approve directly,
-- reject directly, or send it to a group vote (a new explicit action, not
-- automatic). "Sent to a vote" is now tracked by voting_closes_at being set,
-- replacing excuse_type = 'other' as the gating condition everywhere.
-- ============================================================================

-- Only one open GROUP VOTE per group at a time (previously scoped to
-- excuse_type = 'other' specifically, since that was the only type that
-- could ever have an open vote). Multiple pending, not-yet-voted requests of
-- any type can still coexist in the admin's queue, same as before.
drop index if exists one_pending_other_excuse_per_group;
create unique index one_open_excuse_vote_per_group
  on excuse_requests (group_id)
  where status = 'pending' and voting_closes_at is not null;

-- ============================================================================
-- create_excuse_request: every type now goes straight to the admin's pending
-- queue — no vote columns populated here anymore. 'other' keeps its "no
-- proof required" rule; the vote path is now a separate, admin-triggered step
-- (send_excuse_request_to_vote), not automatic.
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
  v_admin_id uuid;
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

  insert into excuse_requests (
    group_id, user_id, excuse_type, requested_start_date, requested_end_date, reason, proof_path
  ) values (
    p_group_id, auth.uid(), p_excuse_type, p_start_date, p_end_date, p_reason, p_proof_path
  ) returning * into v_request;

  select admin_id into v_admin_id from groups where id = p_group_id;
  if v_admin_id is not null then
    perform send_push_notification(
      array[v_admin_id], 'Nueva solicitud de excusa', 'Hay una solicitud de excusa pendiente por revisar.',
      p_category => 'votes'
    );
  end if;

  return v_request;
end;
$$;

-- ============================================================================
-- send_excuse_request_to_vote: admin-only. Opens a group vote on an already-
-- pending request that hasn't been sent to vote yet — same required_votes/
-- member_count_snapshot/voting_closes_at shape create_photo_challenge and the
-- old 'other'-type auto-vote already used.
-- ============================================================================
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

  select count(*) into v_member_count
    from group_members where group_id = v_request.group_id and status in ('active', 'needs_recharge');
  if v_member_count < 1 then
    raise exception 'no active members to vote yet';
  end if;

  update excuse_requests
    set required_votes = floor(v_member_count / 2.0)::int + 1,
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
      p_category => 'votes'
    );
  end if;

  perform send_push_notification(
    array[v_request.user_id], 'Tu excusa está en votación',
    'El administrador puso tu solicitud de excusa a votación del grupo.',
    p_category => 'votes'
  );

  return v_request;
exception
  when unique_violation then
    raise exception 'this group already has an open excuse vote';
end;
$$;

-- ============================================================================
-- approve_excuse_request / reject_excuse_request: now gated on "already sent
-- to a vote" (voting_closes_at is not null) instead of excuse_type = 'other'
-- — any type can be decided directly as long as it hasn't been sent to vote.
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
  if v_request.voting_closes_at is not null then
    raise exception 'this request is already in a group vote, not a direct decision';
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

  perform send_push_notification(
    array[v_request.user_id], 'Tu excusa fue aprobada', 'El administrador aprobó tu solicitud de excusa.',
    p_category => 'votes'
  );

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
  if v_request.voting_closes_at is not null then
    raise exception 'this request is already in a group vote, not a direct decision';
  end if;
  if not is_group_admin(v_request.group_id) then
    raise exception 'only the group admin can reject this request';
  end if;

  update excuse_requests
    set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_decision_note
    where id = p_request_id
    returning * into v_request;

  perform send_push_notification(
    array[v_request.user_id], 'Tu excusa fue rechazada', 'El administrador rechazó tu solicitud de excusa.',
    p_category => 'votes'
  );

  return v_request;
end;
$$;

-- ============================================================================
-- cast_excuse_vote: gated on voting_closes_at being set (sent to vote),
-- instead of excuse_type = 'other'.
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
  if not found or v_request.voting_closes_at is null or v_request.status <> 'pending' or now() >= v_request.voting_closes_at then
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
-- close_expired_excuse_votes: hourly safety net — now matches any type that
-- was sent to a vote (voting_closes_at is not null), not just 'other'.
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
      where status = 'pending' and voting_closes_at is not null and voting_closes_at <= now()
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
      perform send_push_notification(
        array[v_request.user_id], 'Tu excusa fue aprobada', 'El grupo votó a favor de tu solicitud de excusa.',
        p_category => 'votes'
      );
    else
      update excuse_requests set status = 'rejected', decided_at = now() where id = v_request.id;
      perform send_push_notification(
        array[v_request.user_id], 'Tu excusa fue rechazada', 'El grupo votó en contra de tu solicitud de excusa.',
        p_category => 'votes'
      );
    end if;
  end loop;
end;
$$;
