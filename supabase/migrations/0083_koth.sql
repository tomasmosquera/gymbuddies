-- ============================================================================
-- King of the Hill (KOTH): per-group 1RM/max-reps leaderboard across a fixed
-- catalog of exercises. Claiming a better value than the current record
-- crowns the claimant immediately and auto-opens a 72h "invalidate" vote —
-- same voting shape as photo_challenges/excuse_requests/rule_proposals, but
-- the timeout default deliberately matches photo_challenges' "innocent
-- until proven guilty" (stays valid) rather than 0080's "approved by
-- default" (that flip only ever applied to excuses/rule proposals, which
-- are requests waiting on an answer — a KOTH claim is already presumptively
-- true the moment it's crowned, so "nobody proved it fake in time" means it
-- stands, not that it needed approval in the first place).
--
-- koth_claims is the source of truth (append-only log of every accepted
-- champion-claim); koth_records is just an indexed pointer to the current
-- champion's claim id, never a duplicated value — avoids the exact
-- "frozen/denormalized value drifts from source of truth" bug class 0079
-- had to fix for required_votes.
-- ============================================================================

create table koth_exercises (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  metric_type text not null check (metric_type in ('weight_kg', 'reps')),
  sort_order int not null,
  created_at timestamptz not null default now()
);
create unique index koth_exercises_sort_order_idx on koth_exercises (sort_order);

insert into koth_exercises (slug, name, metric_type, sort_order) values
  ('bench_press', 'Bench Press', 'weight_kg', 1),
  ('incline_bench_press', 'Incline Bench Press', 'weight_kg', 2),
  ('back_squat', 'Back Squat', 'weight_kg', 3),
  ('deadlift', 'Deadlift', 'weight_kg', 4),
  ('overhead_press', 'Overhead Press', 'weight_kg', 5),
  ('bicep_curl', 'Bicep Curl', 'weight_kg', 6),
  ('pull_ups', 'Pull-ups', 'reps', 7),
  ('push_ups', 'Push-ups', 'reps', 8),
  ('dips', 'Dips', 'reps', 9),
  ('muscle_ups', 'Muscle-ups', 'reps', 10),
  ('toes_to_bar', 'Toes to Bar', 'reps', 11),
  ('handstand_push_ups', 'Handstand Push-ups', 'reps', 12);

-- ============================================================================
-- koth_claims: every submission that beat the record at the time it was
-- submitted. metric_type is a denormalized copy of the exercise's own field
-- at claim time, so a future catalog edit can't retroactively change how an
-- old claim is interpreted. value_canonical is always what gets compared —
-- kg for weight exercises (converted server-side, never trusting a
-- client-computed kg number), raw rep count for reps exercises.
-- submitted_unit/submitted_value keep an honest record of what the member
-- actually typed, since the record must display in both kg and lbs
-- regardless of which unit was used to submit it.
-- ============================================================================
create table koth_claims (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  exercise_id uuid not null references koth_exercises (id),
  user_id uuid not null references profiles (id) on delete cascade,
  metric_type text not null check (metric_type in ('weight_kg', 'reps')),
  value_canonical numeric(8,3) not null check (value_canonical > 0),
  submitted_unit text check (submitted_unit in ('kg', 'lbs')),
  submitted_value numeric(8,3) not null check (submitted_value > 0),
  video_path text not null,
  status text not null default 'pending_vote' check (status in ('pending_vote', 'valid', 'invalidated')),
  required_votes int not null,
  member_count_snapshot int not null,
  voting_closes_at timestamptz not null,
  decided_at timestamptz,
  decided_by uuid references profiles (id),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index koth_claims_group_exercise_idx on koth_claims (group_id, exercise_id, created_at desc);
create index koth_claims_group_status_idx on koth_claims (group_id, status);
-- At most one claim per (group, exercise) can ever be mid-vote, and it is
-- always the reigning champion — submit_koth_claim always force-finalizes
-- the previous champion's claim to 'valid' before inserting a new one.
create unique index koth_claims_one_pending_idx on koth_claims (group_id, exercise_id) where (status = 'pending_vote');

create table koth_claim_votes (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references koth_claims (id) on delete cascade,
  user_id uuid not null references profiles (id),
  vote text not null check (vote in ('yes', 'no')),
  voted_at timestamptz not null default now(),
  unique (claim_id, user_id)
);

-- Thin pointer/cache, never a duplicated value — every read joins to
-- koth_claims for the actual number.
create table koth_records (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  exercise_id uuid not null references koth_exercises (id),
  current_claim_id uuid references koth_claims (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (group_id, exercise_id)
);
create index koth_records_current_claim_idx on koth_records (current_claim_id);

alter table koth_exercises enable row level security;
alter table koth_claims enable row level security;
alter table koth_claim_votes enable row level security;
alter table koth_records enable row level security;

create policy koth_exercises_select on koth_exercises for select using (true);
create policy koth_claims_select on koth_claims for select using (is_group_member(group_id));
create policy koth_claim_votes_select on koth_claim_votes for select
  using (exists (select 1 from koth_claims kc where kc.id = claim_id and is_group_member(kc.group_id)));
create policy koth_records_select on koth_records for select using (is_group_member(group_id));

revoke insert, update, delete on koth_exercises from authenticated;
revoke insert, update, delete on koth_claims from authenticated;
revoke insert, update, delete on koth_claim_votes from authenticated;
revoke insert, update, delete on koth_records from authenticated;

-- ============================================================================
-- refresh_koth_record: the one place "who's the current champion" gets
-- (re)derived. Because every accepted claim by construction beat the
-- previous record, "the previous champion" for a (group, exercise) is
-- simply the most recent OTHER claim with status <> 'invalidated' — no
-- separate "who was previous" tracking needed, correct by induction no
-- matter how many times the crown has changed hands. Called from every
-- path that can change who's currently valid: vote resolution, admin
-- override, timeout close, and claim-row deletion (account/group cleanup).
-- submit_koth_claim does NOT call this — it always sets current_claim_id to
-- the new claim directly, since the new claim is unconditionally champion.
-- ============================================================================
create or replace function refresh_koth_record(p_group_id uuid, p_exercise_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_claim_id uuid;
begin
  select id into v_next_claim_id
    from koth_claims
    where group_id = p_group_id and exercise_id = p_exercise_id and status <> 'invalidated'
    order by created_at desc limit 1;

  insert into koth_records (group_id, exercise_id, current_claim_id, updated_at)
    values (p_group_id, p_exercise_id, v_next_claim_id, now())
  on conflict (group_id, exercise_id)
    do update set current_claim_id = excluded.current_claim_id, updated_at = now();
end;
$$;

-- ============================================================================
-- submit_koth_claim: validates the claim beats the current record, converts
-- to a canonical kg value server-side, crowns the claimant immediately, and
-- opens the 72h invalidate vote.
-- ============================================================================
create or replace function submit_koth_claim(
  p_group_id uuid,
  p_exercise_id uuid,
  p_value numeric,
  p_video_path text,
  p_unit text default null
)
returns koth_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exercise koth_exercises%rowtype;
  v_record koth_records%rowtype;
  v_current_claim koth_claims%rowtype;
  v_value_canonical numeric(8,3);
  v_eligible int;
  v_required int;
  v_claim koth_claims%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
  v_dethroned_user_id uuid;
  v_path_prefix text;
begin
  if not is_active_participant(p_group_id, auth.uid()) then
    raise exception 'solo los miembros activos pueden reclamar un récord';
  end if;

  select * into v_exercise from koth_exercises where id = p_exercise_id;
  if not found then
    raise exception 'ejercicio no encontrado';
  end if;

  if p_value is null or p_value <= 0 then
    raise exception 'el valor debe ser mayor a 0';
  end if;

  if v_exercise.metric_type = 'weight_kg' then
    if p_unit is null or p_unit not in ('kg', 'lbs') then
      raise exception 'debes indicar la unidad (kg o lbs)';
    end if;
    v_value_canonical := case when p_unit = 'lbs' then p_value * 0.45359237 else p_value end;
  else
    if p_unit is not null then
      raise exception 'este ejercicio no usa peso — no indiques unidad';
    end if;
    if p_value <> trunc(p_value) then
      raise exception 'las repeticiones deben ser un número entero';
    end if;
    v_value_canonical := p_value;
  end if;

  v_path_prefix := p_group_id::text || '/' || auth.uid()::text || '/';
  if p_video_path is null or left(p_video_path, length(v_path_prefix)) <> v_path_prefix then
    raise exception 'video inválido';
  end if;

  insert into koth_records (group_id, exercise_id) values (p_group_id, p_exercise_id)
    on conflict (group_id, exercise_id) do nothing;
  select * into v_record from koth_records where group_id = p_group_id and exercise_id = p_exercise_id for update;

  if v_record.current_claim_id is not null then
    select * into v_current_claim from koth_claims where id = v_record.current_claim_id for update;
    if v_value_canonical <= v_current_claim.value_canonical then
      raise exception 'tu marca no supera el récord actual';
    end if;
    if v_current_claim.status = 'pending_vote' then
      update koth_claims set status = 'valid', decided_at = now() where id = v_current_claim.id;
    end if;
    v_dethroned_user_id := v_current_claim.user_id;
  end if;

  v_eligible := greatest(count_eligible_voters(p_group_id) - 1, 0);
  v_required := majority_threshold(v_eligible);

  insert into koth_claims (
    group_id, exercise_id, user_id, metric_type, value_canonical, submitted_unit, submitted_value,
    video_path, required_votes, member_count_snapshot, voting_closes_at
  ) values (
    p_group_id, p_exercise_id, auth.uid(), v_exercise.metric_type, v_value_canonical, p_unit, p_value,
    p_video_path, v_required, v_eligible, now() + interval '72 hours'
  ) returning * into v_claim;

  update koth_records set current_claim_id = v_claim.id, updated_at = now() where id = v_record.id;

  select full_name into v_full_name from profiles where id = auth.uid();

  perform send_push_notification(
    array[auth.uid()], '¡Nuevo récord!',
    format('¡Eres el nuevo rey/reina de %s!', v_exercise.name),
    p_group_id => p_group_id, p_category => 'achievements'
  );

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva reclamación de King of the Hill',
      format('%s reclamó el récord de %s — revisa el video y vota si algo no cuadra.', v_full_name, v_exercise.name),
      p_group_id => p_group_id, p_category => 'votes'
    );
  end if;

  if v_dethroned_user_id is not null and v_dethroned_user_id <> auth.uid() then
    perform send_push_notification(
      array[v_dethroned_user_id], 'Perdiste el trono',
      format('Tu récord de %s fue superado por %s.', v_exercise.name, v_full_name),
      p_group_id => p_group_id, p_category => 'group_activity'
    );
  end if;

  return v_claim;
end;
$$;

-- ============================================================================
-- cast_koth_claim_vote: mirrors cast_photo_challenge_vote exactly (yes =
-- vote to invalidate). The claimant can't vote on their own claim.
-- ============================================================================
create or replace function cast_koth_claim_vote(p_claim_id uuid, p_vote text)
returns koth_claim_votes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim koth_claims%rowtype;
  v_vote koth_claim_votes%rowtype;
begin
  if p_vote not in ('yes', 'no') then
    raise exception 'vote must be yes or no';
  end if;

  select * into v_claim from koth_claims where id = p_claim_id;
  if not found or v_claim.status <> 'pending_vote' or now() >= v_claim.voting_closes_at then
    raise exception 'this vote is not open';
  end if;
  if auth.uid() = v_claim.user_id then
    raise exception 'no puedes votar tu propia reclamación';
  end if;
  if not is_active_participant(v_claim.group_id, auth.uid()) then
    raise exception 'only active members can vote';
  end if;

  insert into koth_claim_votes (claim_id, user_id, vote)
    values (p_claim_id, auth.uid(), p_vote)
    on conflict (claim_id, user_id) do update set vote = excluded.vote, voted_at = now()
    returning * into v_vote;
  return v_vote;
end;
$$;

-- ============================================================================
-- try_resolve_koth_claim: live early-resolution, same shape as
-- try_resolve_excuse_vote/try_resolve_rule_proposal from 0079 — recomputes
-- required_votes/member_count_snapshot live (not trusting a frozen
-- snapshot) every time it runs, whether triggered by a new vote or by a
-- group_members change.
-- ============================================================================
create or replace function try_resolve_koth_claim(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim koth_claims%rowtype;
  v_exercise koth_exercises%rowtype;
  v_eligible int;
  v_required int;
  v_yes int;
  v_no int;
  v_full_name text;
  v_new_champion_id uuid;
begin
  select * into v_claim from koth_claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'pending_vote' then
    return;
  end if;

  v_eligible := greatest(count_eligible_voters(v_claim.group_id) - 1, 0);
  v_required := majority_threshold(v_eligible);
  update koth_claims set required_votes = v_required, member_count_snapshot = v_eligible where id = p_claim_id;

  select count(*) filter (where vote = 'yes'), count(*) filter (where vote = 'no')
    into v_yes, v_no
    from koth_claim_votes where claim_id = p_claim_id;

  select * into v_exercise from koth_exercises where id = v_claim.exercise_id;
  select full_name into v_full_name from profiles where id = v_claim.user_id;

  if v_yes >= v_required then
    update koth_claims set status = 'invalidated', decided_at = now() where id = p_claim_id;
    perform refresh_koth_record(v_claim.group_id, v_claim.exercise_id);

    perform send_push_notification(
      array[v_claim.user_id], 'Tu récord fue invalidado',
      format('El grupo votó que tu reclamación de %s no era válida — perdiste el trono.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );

    select current_claim_id into v_new_champion_id from koth_records
      where group_id = v_claim.group_id and exercise_id = v_claim.exercise_id;
    if v_new_champion_id is not null then
      perform send_push_notification(
        array[(select user_id from koth_claims where id = v_new_champion_id)], 'Recuperaste el trono',
        format('Volviste a ser el rey/reina de %s.', v_exercise.name),
        p_group_id => v_claim.group_id, p_category => 'achievements'
      );
    end if;
  elsif v_no > (v_eligible - v_required) then
    update koth_claims set status = 'valid', decided_at = now() where id = p_claim_id;
    perform send_push_notification(
      array[v_claim.user_id], 'Tu récord quedó confirmado',
      format('El grupo no logró invalidar tu reclamación de %s — el récord queda en pie.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );
  end if;
end;
$$;

create or replace function resolve_koth_claim_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform try_resolve_koth_claim(coalesce(new.claim_id, old.claim_id));
  return null;
end;
$$;

create trigger trg_resolve_koth_claim_vote
  after insert or update on koth_claim_votes
  for each row execute function resolve_koth_claim_vote();

-- ============================================================================
-- admin_decide_koth_claim: admin bypass, mirrors admin_decide_photo_challenge.
-- ============================================================================
create or replace function admin_decide_koth_claim(p_claim_id uuid, p_valid boolean)
returns koth_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim koth_claims%rowtype;
  v_exercise koth_exercises%rowtype;
  v_new_champion_id uuid;
begin
  select * into v_claim from koth_claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'pending_vote' then
    raise exception 'this claim is not open';
  end if;
  if not is_group_admin(v_claim.group_id) then
    raise exception 'only the group admin can decide this claim';
  end if;

  select * into v_exercise from koth_exercises where id = v_claim.exercise_id;

  if p_valid then
    update koth_claims set status = 'valid', decided_at = now(), decided_by = auth.uid() where id = p_claim_id
      returning * into v_claim;
    perform send_push_notification(
      array[v_claim.user_id], 'Tu récord quedó confirmado',
      format('El administrador confirmó tu reclamación de %s.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );
  else
    update koth_claims set status = 'invalidated', decided_at = now(), decided_by = auth.uid() where id = p_claim_id
      returning * into v_claim;
    perform refresh_koth_record(v_claim.group_id, v_claim.exercise_id);
    perform send_push_notification(
      array[v_claim.user_id], 'Tu récord fue invalidado',
      format('El administrador invalidó tu reclamación de %s.', v_exercise.name),
      p_group_id => v_claim.group_id, p_category => 'votes'
    );
    select current_claim_id into v_new_champion_id from koth_records
      where group_id = v_claim.group_id and exercise_id = v_claim.exercise_id;
    if v_new_champion_id is not null then
      perform send_push_notification(
        array[(select user_id from koth_claims where id = v_new_champion_id)], 'Recuperaste el trono',
        format('Volviste a ser el rey/reina de %s.', v_exercise.name),
        p_group_id => v_claim.group_id, p_category => 'achievements'
      );
    end if;
  end if;

  return v_claim;
end;
$$;

-- ============================================================================
-- close_expired_koth_claims: hourly cron safety net. Recomputes live (same
-- fix 0079 gave excuses/rules) and, unlike excuses/rules since 0080,
-- defaults to 'valid' on timeout — matches photo_challenges' "innocent
-- until proven guilty", not the newer "approved by default" default.
-- ============================================================================
create or replace function close_expired_koth_claims()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_exercise koth_exercises%rowtype;
  v_eligible int;
  v_required int;
  v_yes int;
  v_new_champion_id uuid;
begin
  for v_claim in
    select * from koth_claims where status = 'pending_vote' and voting_closes_at <= now() for update
  loop
    v_eligible := greatest(count_eligible_voters(v_claim.group_id) - 1, 0);
    v_required := majority_threshold(v_eligible);

    select count(*) filter (where vote = 'yes') into v_yes from koth_claim_votes where claim_id = v_claim.id;
    select * into v_exercise from koth_exercises where id = v_claim.exercise_id;

    if v_yes >= v_required then
      update koth_claims
        set status = 'invalidated', decided_at = now(), required_votes = v_required, member_count_snapshot = v_eligible
        where id = v_claim.id;
      perform refresh_koth_record(v_claim.group_id, v_claim.exercise_id);
      perform send_push_notification(
        array[v_claim.user_id], 'Tu récord fue invalidado',
        format('El grupo votó que tu reclamación de %s no era válida — perdiste el trono.', v_exercise.name),
        p_group_id => v_claim.group_id, p_category => 'votes'
      );
      select current_claim_id into v_new_champion_id from koth_records
        where group_id = v_claim.group_id and exercise_id = v_claim.exercise_id;
      if v_new_champion_id is not null then
        perform send_push_notification(
          array[(select user_id from koth_claims where id = v_new_champion_id)], 'Recuperaste el trono',
          format('Volviste a ser el rey/reina de %s.', v_exercise.name),
          p_group_id => v_claim.group_id, p_category => 'achievements'
        );
      end if;
    else
      update koth_claims
        set status = 'valid', decided_at = now(), required_votes = v_required, member_count_snapshot = v_eligible
        where id = v_claim.id;
      perform send_push_notification(
        array[v_claim.user_id], 'Tu récord quedó confirmado',
        format(
          'El plazo de votación terminó sin que el grupo lograra invalidar tu reclamación de %s — el récord queda en pie.',
          v_exercise.name
        ),
        p_group_id => v_claim.group_id, p_category => 'votes'
      );
    end if;
  end loop;
end;
$$;

select cron.schedule('close-expired-koth-claims', '0 * * * *', $$select close_expired_koth_claims();$$);

-- ============================================================================
-- handle_koth_claim_deleted: keeps koth_records correct when a claim row
-- disappears out from under it (account deletion cascade) — walks back to
-- whoever's next in line via the same refresh_koth_record used everywhere
-- else, or vacant if nobody's left.
-- ============================================================================
create or replace function handle_koth_claim_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform refresh_koth_record(old.group_id, old.exercise_id);
  return null;
end;
$$;

create trigger trg_koth_claim_deleted
  after delete on koth_claims
  for each row execute function handle_koth_claim_deleted();

-- ============================================================================
-- Extend the 0079 group_members live-refresh trigger to also cover open
-- KOTH votes — otherwise a membership change (someone leaves, rejoins, or
-- their activation date is edited) would recompute excuse/rule thresholds
-- live but leave a KOTH claim's required_votes stale, reintroducing the
-- exact bug 0079 fixed for the other two systems.
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

  for v_id in select id from koth_claims where group_id = v_group_id and status = 'pending_vote' loop
    perform try_resolve_koth_claim(v_id);
  end loop;

  return null;
end;
$$;

-- ============================================================================
-- Extend the 0080 "1 hour left" reminder to also cover open KOTH votes.
-- Reuses the existing voting-deadline-reminders cron (*/15 * * * *) — no
-- new job needed, koth_claims.reminder_sent_at was declared above.
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
  v_claim record;
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

  for v_claim in
    select * from koth_claims
      where status = 'pending_vote'
        and voting_closes_at <= now() + interval '1 hour' and voting_closes_at > now()
        and reminder_sent_at is null
      for update
  loop
    select array_agg(gm.user_id) into v_recipient_ids
      from group_members gm
      where gm.group_id = v_claim.group_id
        and gm.status in ('active', 'needs_recharge')
        and coalesce(gm.activated_at, gm.joined_at) <= now()
        and gm.user_id <> v_claim.user_id
        and not exists (
          select 1 from koth_claim_votes kcv where kcv.claim_id = v_claim.id and kcv.user_id = gm.user_id
        );

    if v_recipient_ids is not null then
      perform send_push_notification(
        v_recipient_ids, 'Última hora para votar',
        'Queda 1 hora para que cierre la votación de una reclamación de King of the Hill. Si nadie logra invalidarla, el récord queda confirmado.',
        p_group_id => v_claim.group_id, p_category => 'votes'
      );
    end if;

    update koth_claims set reminder_sent_at = now() where id = v_claim.id;
  end loop;
end;
$$;

-- ============================================================================
-- Extend delete_own_account()/close_group() to also clean up koth-videos —
-- edits to existing live functions, not new code added independently.
-- koth_claims.user_id has "on delete cascade" from profiles, so a deleted
-- user's claim rows disappear on their own; trg_koth_claim_deleted (above)
-- repairs koth_records if one of them was a still-standing champion.
-- ============================================================================
create or replace function delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if exists (
    select 1 from groups g
      join group_members gm on gm.group_id = g.id
      where g.admin_id = v_user_id
        and gm.user_id <> v_user_id
        and gm.status in ('active', 'needs_recharge', 'pending_deposit')
  ) then
    raise exception 'eres admin de un grupo con otros miembros — transfiere la administración o remuévelos primero';
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name in (
    select photo_path from checkins where user_id = v_user_id
    union
    select checkout_photo_path from checkins where user_id = v_user_id and checkout_photo_path is not null
  );
  delete from storage.objects where bucket_id = 'receipts' and name in (
    select receipt_path from wallet_transactions where user_id = v_user_id and receipt_path is not null
  );
  delete from storage.objects where bucket_id = 'excuse-proofs' and name in (
    select unnest(proof_paths) from excuse_requests where user_id = v_user_id and array_length(proof_paths, 1) > 0
  );
  delete from storage.objects where bucket_id = 'koth-videos' and name in (
    select video_path from koth_claims where user_id = v_user_id
  );

  delete from groups where admin_id = v_user_id;

  delete from auth.users where id = v_user_id;
end;
$$;

create or replace function close_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_member_ids uuid[];
  v_member record;
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;
  if not is_group_admin(p_group_id) then
    raise exception 'solo el administrador puede cerrar el grupo';
  end if;

  select array_agg(user_id) into v_member_ids
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

  if v_member_ids is not null and array_length(v_member_ids, 1) > 0 then
    begin
      perform liquidate_group_now(p_group_id, false);
    exception
      when others then
        if sqlerrm not ilike '%ciclo de Liga%' then
          raise;
        end if;
        for v_member in
          select user_id, balance from group_members
            where group_id = p_group_id and status in ('active', 'needs_recharge') and balance <> 0
        loop
          insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
            values (
              p_group_id, v_member.user_id, 'payout', -v_member.balance, 'confirmed',
              format('cierre del grupo: se te devuelve tu saldo (%s %s)', v_member.balance, v_group.currency), now()
            );
        end loop;
    end;

    perform send_push_notification(
      v_member_ids, 'Grupo cerrado',
      format('El administrador cerró el grupo "%s". Cualquier saldo pendiente ya fue liquidado — revisa tu saldo.', v_group.name),
      p_group_id => p_group_id, p_category => 'money'
    );
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name like p_group_id::text || '/%';
  delete from storage.objects where bucket_id = 'receipts' and name like p_group_id::text || '/%';
  delete from storage.objects where bucket_id = 'excuse-proofs' and name like p_group_id::text || '/%';
  delete from storage.objects where bucket_id = 'koth-videos' and name like p_group_id::text || '/%';

  delete from groups where id = p_group_id;
end;
$$;
