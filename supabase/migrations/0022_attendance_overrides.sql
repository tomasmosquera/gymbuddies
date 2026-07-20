-- ============================================================================
-- attendance_overrides: lets the admin directly declare a specific day for a
-- specific member as 'valid' (counts as trained, even with no check-in) or
-- 'failed' (does NOT count as trained, even if a check-in exists) — no
-- vote, no member-side approval, admin-only and immediate. One override per
-- (group, user, date); setting it again just replaces the previous verdict.
-- ============================================================================
create table attendance_overrides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  override_date date not null,
  status text not null check (status in ('valid', 'failed')),
  set_by uuid not null references profiles (id),
  note text,
  created_at timestamptz not null default now(),
  unique (group_id, user_id, override_date)
);

create index attendance_overrides_group_user_date_idx on attendance_overrides (group_id, user_id, override_date);

alter table attendance_overrides enable row level security;

-- Readable by any group member (it affects their standing on the shared
-- leaderboard/rules screens, same visibility level as checkins/excuse_dates).
-- All writes go through the RPCs below (security definer) — no direct
-- insert/update/delete policy for clients.
create policy attendance_overrides_select on attendance_overrides
  for select
  using (is_group_member(group_id));

revoke insert, update, delete on attendance_overrides from authenticated;

create or replace function set_attendance_override(
  p_group_id uuid,
  p_user_id uuid,
  p_date date,
  p_status text,
  p_note text default null
)
returns attendance_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override attendance_overrides%rowtype;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can set attendance overrides';
  end if;
  if p_status not in ('valid', 'failed') then
    raise exception 'status must be valid or failed';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'user is not a member of this group';
  end if;

  insert into attendance_overrides (group_id, user_id, override_date, status, set_by, note)
    values (p_group_id, p_user_id, p_date, p_status, auth.uid(), p_note)
    on conflict (group_id, user_id, override_date)
    do update set status = excluded.status, set_by = excluded.set_by, note = excluded.note, created_at = now()
    returning * into v_override;
  return v_override;
end;
$$;

create or replace function clear_attendance_override(p_group_id uuid, p_user_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can clear attendance overrides';
  end if;

  delete from attendance_overrides
    where group_id = p_group_id and user_id = p_user_id and override_date = p_date;
end;
$$;

-- ============================================================================
-- run_weekly_evaluation: a day now counts as completed if there's a
-- check-in OR a 'valid' override, UNLESS a 'failed' override exists for that
-- same date — the failed verdict always wins, even over a real check-in.
-- Required/excused-day math is unchanged; overrides only affect whether a
-- given day counts as completed.
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
      select count(distinct d.the_date) into v_completed
        from (
          select checkin_date as the_date from checkins
            where group_id = v_group.id and user_id = v_member.user_id
              and checkin_date between v_week_start and v_week_end
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
