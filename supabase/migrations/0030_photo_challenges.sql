-- ============================================================================
-- photo_challenges: any voting member (other than the check-in's own owner)
-- can challenge a check-in as not really proof of a workout. Resolves either
-- by group majority vote (same shape as rule_proposals/excuse_requests) or
-- by direct admin decision (mirrors attendance_overrides' "admin acts alone,
-- no vote" precedent). An "invalid" outcome writes a 'failed'
-- attendance_override for that user/date — reusing the existing override
-- machinery instead of inventing a second way to affect weekly evaluation.
-- ============================================================================
create table photo_challenges (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  checkin_id uuid not null references checkins (id) on delete cascade,
  target_user_id uuid not null references profiles (id),
  challenged_by uuid not null references profiles (id),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'invalid', 'valid')),
  required_votes int not null,
  member_count_snapshot int not null,
  voting_closes_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- Only one open challenge per check-in at a time; a resolved one can be
-- re-challenged later if someone still disagrees.
create unique index photo_challenges_open_idx on photo_challenges (checkin_id) where (status = 'pending');
create index photo_challenges_group_status_idx on photo_challenges (group_id, status);

create table photo_challenge_votes (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references photo_challenges (id) on delete cascade,
  user_id uuid not null references profiles (id),
  vote text not null check (vote in ('yes', 'no')),
  voted_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

alter table photo_challenges enable row level security;
alter table photo_challenge_votes enable row level security;

create policy photo_challenges_select on photo_challenges
  for select
  using (is_group_member(group_id));

create policy photo_challenge_votes_select on photo_challenge_votes
  for select
  using (exists (select 1 from photo_challenges pc where pc.id = challenge_id and is_group_member(pc.group_id)));

revoke insert, update, delete on photo_challenges from authenticated;
revoke insert, update, delete on photo_challenge_votes from authenticated;

-- ============================================================================
-- create_photo_challenge: opens the vote. The target can't challenge their
-- own photo, and isn't counted in the eligible-voter pool (member_count_
-- snapshot), since they can't vote on it either (see cast_photo_challenge_vote).
-- ============================================================================
create or replace function create_photo_challenge(p_checkin_id uuid, p_reason text default null)
returns photo_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_member_count int;
  v_challenge photo_challenges%rowtype;
  v_recipient_ids uuid[];
begin
  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_voting_member(v_checkin.group_id, auth.uid()) then
    raise exception 'only active members can challenge a photo';
  end if;
  if v_checkin.user_id = auth.uid() then
    raise exception 'you cannot challenge your own photo';
  end if;

  select count(*) into v_member_count
    from group_members
    where group_id = v_checkin.group_id and status in ('active', 'needs_recharge') and user_id <> v_checkin.user_id;
  if v_member_count < 1 then
    raise exception 'no eligible members to vote yet';
  end if;

  insert into photo_challenges (
    group_id, checkin_id, target_user_id, challenged_by, reason, required_votes, member_count_snapshot, voting_closes_at
  ) values (
    v_checkin.group_id, p_checkin_id, v_checkin.user_id, auth.uid(), p_reason,
    floor(v_member_count / 2.0)::int + 1, v_member_count, now() + interval '72 hours'
  ) returning * into v_challenge;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = v_checkin.group_id and status in ('active', 'needs_recharge')
      and user_id <> auth.uid() and user_id <> v_checkin.user_id;
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva votación de foto', 'Alguien pidió invalidar la foto de un check-in — ve a votar.'
    );
  end if;

  perform send_push_notification(
    array[v_checkin.user_id], 'Tu foto está en votación',
    'Un miembro del grupo pidió invalidar tu check-in. El grupo va a votar si es válido.'
  );

  return v_challenge;
exception
  when unique_violation then
    raise exception 'este check-in ya tiene una votación abierta';
end;
$$;

create or replace function cast_photo_challenge_vote(p_challenge_id uuid, p_vote text)
returns photo_challenge_votes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge photo_challenges%rowtype;
  v_vote photo_challenge_votes%rowtype;
begin
  if p_vote not in ('yes', 'no') then
    raise exception 'vote must be yes or no';
  end if;

  select * into v_challenge from photo_challenges where id = p_challenge_id;
  if not found or v_challenge.status <> 'pending' or now() >= v_challenge.voting_closes_at then
    raise exception 'this vote is not open';
  end if;
  if auth.uid() = v_challenge.target_user_id then
    raise exception 'you cannot vote on a challenge against your own photo';
  end if;
  if not is_voting_member(v_challenge.group_id, auth.uid()) then
    raise exception 'only active members can vote';
  end if;

  insert into photo_challenge_votes (challenge_id, user_id, vote)
    values (p_challenge_id, auth.uid(), p_vote)
    on conflict (challenge_id, user_id) do update set vote = excluded.vote, voted_at = now()
    returning * into v_vote;
  return v_vote;
end;
$$;

-- ============================================================================
-- resolve_photo_challenge: same early-majority shape as resolve_rule_proposal
-- / resolve_excuse_vote. On "invalid", upserts a 'failed' attendance_override
-- for the target's check-in date — the same effect set_attendance_override
-- would have, just written directly since this fires from a vote, not an
-- admin action.
-- ============================================================================
create or replace function resolve_photo_challenge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge photo_challenges%rowtype;
  v_checkin checkins%rowtype;
  v_yes int;
  v_no int;
  v_challenge_id uuid := coalesce(new.challenge_id, old.challenge_id);
begin
  select * into v_challenge from photo_challenges where id = v_challenge_id for update;
  if v_challenge.status <> 'pending' then
    return null;
  end if;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from photo_challenge_votes where challenge_id = v_challenge_id;

  if v_yes >= v_challenge.required_votes then
    update photo_challenges set status = 'invalid', decided_at = now() where id = v_challenge_id;
    select * into v_checkin from checkins where id = v_challenge.checkin_id;
    insert into attendance_overrides (group_id, user_id, override_date, status, set_by, note)
      values (
        v_challenge.group_id, v_challenge.target_user_id, v_checkin.checkin_date, 'failed',
        v_challenge.challenged_by, 'Foto invalidada por votación del grupo'
      )
      on conflict (group_id, user_id, override_date)
      do update set status = 'failed', set_by = excluded.set_by, note = excluded.note, created_at = now();
    perform send_push_notification(
      array[v_challenge.target_user_id], 'Tu foto fue invalidada',
      'El grupo votó que tu check-in no era válido — ese día ahora cuenta como fallado.'
    );
  elsif v_no > (v_challenge.member_count_snapshot - v_challenge.required_votes) then
    update photo_challenges set status = 'valid', decided_at = now() where id = v_challenge_id;
    perform send_push_notification(
      array[v_challenge.target_user_id], 'Tu foto fue validada', 'El grupo votó que tu check-in sí es válido.'
    );
  end if;

  return null;
end;
$$;

create trigger trg_resolve_photo_challenge
  after insert or update on photo_challenge_votes
  for each row execute function resolve_photo_challenge();

-- ============================================================================
-- admin_decide_photo_challenge: the admin can also settle a challenge
-- directly, no vote required — same "admin acts immediately" precedent as
-- set_attendance_override.
-- ============================================================================
create or replace function admin_decide_photo_challenge(p_challenge_id uuid, p_valid boolean)
returns photo_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge photo_challenges%rowtype;
  v_checkin checkins%rowtype;
begin
  select * into v_challenge from photo_challenges where id = p_challenge_id for update;
  if not found or v_challenge.status <> 'pending' then
    raise exception 'this challenge is not open';
  end if;
  if not is_group_admin(v_challenge.group_id) then
    raise exception 'only the group admin can decide directly';
  end if;

  if p_valid then
    update photo_challenges set status = 'valid', decided_at = now(), decided_by = auth.uid() where id = p_challenge_id;
    perform send_push_notification(
      array[v_challenge.target_user_id], 'Tu foto fue validada', 'El administrador decidió que tu check-in sí es válido.'
    );
  else
    update photo_challenges set status = 'invalid', decided_at = now(), decided_by = auth.uid() where id = p_challenge_id;
    select * into v_checkin from checkins where id = v_challenge.checkin_id;
    insert into attendance_overrides (group_id, user_id, override_date, status, set_by, note)
      values (
        v_challenge.group_id, v_challenge.target_user_id, v_checkin.checkin_date, 'failed',
        auth.uid(), 'Foto invalidada por el administrador'
      )
      on conflict (group_id, user_id, override_date)
      do update set status = 'failed', set_by = excluded.set_by, note = excluded.note, created_at = now();
    perform send_push_notification(
      array[v_challenge.target_user_id], 'Tu foto fue invalidada',
      'El administrador decidió que tu check-in no era válido — ese día ahora cuenta como fallado.'
    );
  end if;

  select * into v_challenge from photo_challenges where id = p_challenge_id;
  return v_challenge;
end;
$$;

-- ============================================================================
-- close_expired_photo_challenges: hourly safety net, mirrors
-- close_expired_proposals — always resolves one way or the other; timing out
-- without enough "invalid" votes defaults to the photo staying valid.
-- ============================================================================
create or replace function close_expired_photo_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge record;
  v_checkin checkins%rowtype;
  v_yes int;
begin
  for v_challenge in
    select * from photo_challenges where status = 'pending' and voting_closes_at <= now() for update
  loop
    select count(*) filter (where vote = 'yes') into v_yes
      from photo_challenge_votes where challenge_id = v_challenge.id;

    if v_yes >= v_challenge.required_votes then
      update photo_challenges set status = 'invalid', decided_at = now() where id = v_challenge.id;
      select * into v_checkin from checkins where id = v_challenge.checkin_id;
      insert into attendance_overrides (group_id, user_id, override_date, status, set_by, note)
        values (
          v_challenge.group_id, v_challenge.target_user_id, v_checkin.checkin_date, 'failed',
          v_challenge.challenged_by, 'Foto invalidada por votación del grupo'
        )
        on conflict (group_id, user_id, override_date)
        do update set status = 'failed', set_by = excluded.set_by, note = excluded.note, created_at = now();
      perform send_push_notification(
        array[v_challenge.target_user_id], 'Tu foto fue invalidada',
        'El grupo votó que tu check-in no era válido — ese día ahora cuenta como fallado.'
      );
    else
      update photo_challenges set status = 'valid', decided_at = now() where id = v_challenge.id;
      perform send_push_notification(
        array[v_challenge.target_user_id], 'Tu foto fue validada', 'El grupo votó que tu check-in sí es válido.'
      );
    end if;
  end loop;
end;
$$;

select cron.schedule('close-expired-photo-challenges', '0 * * * *', $$select close_expired_photo_challenges();$$);
