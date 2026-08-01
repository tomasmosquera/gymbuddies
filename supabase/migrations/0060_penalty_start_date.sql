-- ============================================================================
-- Separates "when a member starts counting for everything" (activated_at,
-- unchanged) from "when a member can start being financially penalized"
-- (new: penalty_start_date). Two real cases prompted this:
--
-- - A member who wants to train for real right away (counted in ranking,
--   consistency, badges — everything) but shouldn't be penalized for missed
--   days until an agreed-upon future date.
-- - A member who's only observing for now (shouldn't count for anything,
--   already correctly handled by activated_at) — but while investigating
--   this we found voting/proposing rule changes and excuses only checked
--   is_voting_member (status), never activation date, so a not-yet-active
--   member could still vote. Fixed via a new is_active_participant() gate.
--
-- penalty_start_date is nullable with no backfill: every read coalesces to
-- activated_at (then joined_at), so every existing member behaves exactly
-- as before until an admin explicitly sets a later date.
-- ============================================================================
alter table group_members add column penalty_start_date timestamptz;

-- Frozen per week at evaluation time (same as every other decided value in
-- this table) so the client can tell "a genuinely clean week" apart from "a
-- week that was still under penalty protection" without re-deriving the
-- date math — used to keep the "sin penalizaciones" monthly challenge from
-- being trivially satisfied by protected weeks.
alter table weekly_evaluation_results add column penalty_protected boolean not null default false;

-- ============================================================================
-- is_active_participant: is_voting_member() plus "has this member's
-- activation date actually arrived yet". Used only for gating
-- proposing/voting actions (rule proposals, excuse requests/votes, photo
-- challenges/votes) — deliberately NOT used for submit_checkin/
-- submit_workout_checkout, which must keep working regardless of
-- activation date (the checkin's effects are already correctly excluded
-- everywhere else by the existing activated_at filtering).
-- ============================================================================
create or replace function is_active_participant(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_voting_member(p_group_id, p_user_id)
    and exists (
      select 1 from group_members
      where group_id = p_group_id and user_id = p_user_id
        and coalesce(activated_at, joined_at) <= now()
    );
$$;

create or replace function admin_set_member_penalty_start_date(p_member_id uuid, p_date date)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
begin
  select * into v_member from group_members where id = p_member_id;
  if not found then
    raise exception 'member not found';
  end if;
  if not is_group_admin(v_member.group_id) then
    raise exception 'only the group admin can change a member''s penalty start date';
  end if;

  update group_members
    set penalty_start_date = (p_date::timestamp) at time zone 'America/Bogota'
    where id = p_member_id
    returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Tu fecha de inicio de penalizaciones cambió',
    format('El administrador ajustó la fecha desde la que pueden penalizarte a partir del %s.', to_char(p_date, 'DD/MM/YYYY')),
    p_group_id => v_member.group_id, p_category => 'admin_actions'
  );

  return v_member;
end;
$$;

-- ============================================================================
-- run_weekly_evaluation: adds a second, parallel quota computation using
-- penalty_start_date instead of activated_at. required_days/completed_days/
-- failed_days stored on weekly_evaluation_results stay activation-based
-- (unchanged) — that's what drives consistency %, ranking, and the "0
-- failed days" challenge, and must keep reflecting real performance. Only
-- the charged penalty itself is derived from the new, possibly-smaller
-- penalty-eligible quota.
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
  v_penalty_start_date date;
  v_penalty_days_present int;
  v_penalty_required int;
  v_effective_penalty_required int;
  v_failed_for_penalty int;
  v_penalty_protected boolean;
  v_penalty numeric(12, 2);
  v_result_id uuid;
  v_run_ids uuid[] := '{}';
  v_due_proposal_id uuid;
  v_message text;
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
        where group_id = v_group.id and status in ('pending_deposit', 'active', 'needs_recharge')
    loop
      v_activated_date := (coalesce(v_member.activated_at, v_member.joined_at) at time zone 'America/Bogota')::date;
      v_penalty_start_date := (
        coalesce(v_member.penalty_start_date, v_member.activated_at, v_member.joined_at) at time zone 'America/Bogota'
      )::date;

      select count(distinct d.the_date) into v_completed
        from (
          select checkin_date as the_date from checkins
            where group_id = v_group.id and user_id = v_member.user_id
              and checkin_date between v_week_start and v_week_end
              and checkin_date >= v_activated_date
          union
          select override_date as the_date from attendance_overrides
            where group_id = v_group.id and user_id = v_member.user_id and status = 'valid'
              and override_date between v_week_start and v_week_end
        ) d
        where not exists (
          select 1 from attendance_overrides fo
            where fo.group_id = v_group.id and fo.user_id = v_member.user_id and fo.status = 'failed'
              and fo.override_date = d.the_date
        );

      select count(*) into v_excused
        from excuse_dates
        where group_id = v_group.id and user_id = v_member.user_id
          and excused_date between v_week_start and v_week_end;

      v_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_activated_date)) + 1));
      v_required := least(v_group.min_days_per_week, v_days_present);
      v_effective_required := greatest(v_required - v_excused, 0);
      v_failed := greatest(v_effective_required - v_completed, 0);

      v_penalty_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_penalty_start_date)) + 1));
      v_penalty_required := least(v_group.min_days_per_week, v_penalty_days_present);
      v_effective_penalty_required := greatest(v_penalty_required - v_excused, 0);
      v_failed_for_penalty := greatest(v_effective_penalty_required - v_completed, 0);
      v_penalty_protected := v_penalty_start_date > v_week_start;

      v_penalty := least(v_failed_for_penalty * v_group.penalty_amount, v_group.weekly_penalty_cap);

      insert into weekly_evaluation_results (
        run_id, group_id, user_id, required_days, completed_days,
        excused_days_used, failed_days, penalty_charged, penalty_protected,
        balance_before, balance_after, status_after
      ) values (
        v_run_id, v_group.id, v_member.user_id, v_required, v_completed,
        v_excused, v_failed, v_penalty, v_penalty_protected, v_member.balance,
        v_member.balance - v_penalty,
        case when v_member.balance - v_penalty <= 0 then 'needs_recharge' else 'active' end
      ) returning id into v_result_id;

      if v_failed = 0 then
        v_message := format('¡Cumpliste tu meta esta semana! Entrenaste %s de %s días requeridos.', v_completed, v_required);
      elsif v_penalty = 0 and v_penalty_protected then
        v_message := format(
          'Esta semana entrenaste %s de %s días requeridos (%s fallado(s)), pero tu periodo de gracia sigue activo — sin penalización.',
          v_completed, v_required, v_failed
        );
      else
        v_message := format(
          'Esta semana entrenaste %s de %s días requeridos (%s fallado(s)). Penalización: %s %s.',
          v_completed, v_required, v_failed, v_group.currency, to_char(v_penalty, 'FM999,999,999')
        );
      end if;
      perform send_push_notification(
        array[v_member.user_id], 'Resultado semanal', v_message,
        p_group_id => v_group.id, p_category => 'money'
      );

      if v_member.balance - v_penalty <= 0 then
        perform send_push_notification(
          array[v_member.user_id], 'Gym Buddies', 'Tu saldo llegó a $0 — recarga para seguir participando en el grupo.',
          p_group_id => v_group.id, p_category => 'money'
        );
      end if;

      if v_penalty > 0 then
        insert into wallet_transactions (
          group_id, user_id, type, amount, status, weekly_evaluation_result_id, confirmed_at
        ) values (
          v_group.id, v_member.user_id, 'penalty', -v_penalty, 'confirmed', v_result_id, now()
        );
      end if;
    end loop;

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
-- Proposing/voting RPCs: swap is_voting_member -> is_active_participant.
-- Everything else about these functions is unchanged.
-- ============================================================================
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

  if not is_active_participant(v_proposal.group_id, auth.uid()) then
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

create or replace function create_excuse_request(
  p_group_id uuid, p_excuse_type text, p_start_date date, p_end_date date,
  p_reason text default null, p_proof_path text default null
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
  if not is_active_participant(p_group_id, auth.uid()) then
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
      p_group_id => p_group_id, p_category => 'votes'
    );
  end if;

  return v_request;
end;
$$;

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
  if not is_active_participant(v_request.group_id, auth.uid()) then
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
  v_full_name text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to challenge a photo';
  end if;
  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_active_participant(v_checkin.group_id, auth.uid()) then
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
    v_checkin.group_id, p_checkin_id, v_checkin.user_id, auth.uid(), btrim(p_reason),
    floor(v_member_count / 2.0)::int + 1, v_member_count, now() + interval '72 hours'
  ) returning * into v_challenge;

  select full_name into v_full_name from profiles where id = auth.uid();

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = v_checkin.group_id and status in ('active', 'needs_recharge')
      and user_id <> auth.uid() and user_id <> v_checkin.user_id;
  if v_recipient_ids is not null then
    -- p_group_id was missing here before this migration — send_push_notification
    -- has required it since 0053, so creating a photo challenge always threw
    -- before completing. Real, pre-existing bug, fixed as part of this change
    -- since this function was already being touched for is_active_participant.
    perform send_push_notification(
      v_recipient_ids, 'Nueva votación de foto', format('%s pidió invalidar la foto de un check-in — ve a votar.', v_full_name),
      p_group_id => v_checkin.group_id, p_category => 'votes'
    );
  end if;

  perform send_push_notification(
    array[v_checkin.user_id], 'Tu foto está en votación',
    format('%s pidió invalidar tu check-in. El grupo va a votar si es válido.', v_full_name),
    p_group_id => v_checkin.group_id, p_category => 'votes'
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
  if not is_active_participant(v_challenge.group_id, auth.uid()) then
    raise exception 'only active members can vote';
  end if;

  insert into photo_challenge_votes (challenge_id, user_id, vote)
    values (p_challenge_id, auth.uid(), p_vote)
    on conflict (challenge_id, user_id) do update set vote = excluded.vote, voted_at = now()
    returning * into v_vote;
  return v_vote;
end;
$$;
