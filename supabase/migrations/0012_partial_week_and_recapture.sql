-- ============================================================================
-- Fairness fix: a member who joins mid-week should not be graded against the
-- full week. We now track the instant a member first becomes 'active' (their
-- deposit gets confirmed) and use it to shrink that week's required days to
-- however many days they were actually an accountable member for. Days
-- before joining are simply excluded — neither a success nor a failure.
-- ============================================================================
alter table group_members add column activated_at timestamptz;

-- Backfill for members who were already active before this migration ran;
-- joined_at is the best approximation available for pre-existing rows.
update group_members
  set activated_at = joined_at
  where status in ('active', 'needs_recharge') and activated_at is null;

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
          end,
          activated_at = case
            when activated_at is null and balance + new.amount > 0 and status = 'pending_deposit' then now()
            else activated_at
          end
      where group_id = new.group_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- checkins: allow a member to re-take *today's* photo (self-service, same
-- calendar day only). Past days stay immutable proof. The date-derivation +
-- clock-drift guard now also runs on UPDATE, and additionally forbids moving
-- a check-in to a different day than the one it was originally recorded for.
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
  if tg_op = 'UPDATE' and new.checkin_date <> old.checkin_date then
    raise exception 'a check-in cannot be moved to a different day; take a new one instead';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_checkin_date on checkins;
create trigger trg_checkin_date
  before insert or update on checkins
  for each row execute function set_checkin_date();

-- Only the columns a re-capture actually changes; id/group_id/user_id/
-- created_at stay fixed. checkin_date itself is trigger-derived, not
-- client-set, so it doesn't need to be in this grant (see 0007/0009 for why
-- security definer trigger writes don't need a matching column grant).
grant update (captured_at, latitude, longitude, location_accuracy_m, photo_path) on checkins to authenticated;

create policy checkins_update_self_today on checkins
  for update
  using (
    user_id = auth.uid()
    and checkin_date = (now() at time zone 'America/Bogota')::date
  )
  with check (user_id = auth.uid());

-- ============================================================================
-- run_weekly_evaluation: same algorithm as before, but required_days is now
-- capped at how many days of that week the member was actually active for
-- (min_days_per_week is meaningless if you joined on Friday). Vacation days
-- still layer on top of that prorated requirement.
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
  v_vacation int;
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

      select count(*) into v_vacation
        from vacation_days
        where group_id = v_group.id and user_id = v_member.user_id
          and vacation_date between v_week_start and v_week_end;

      v_activated_date := (coalesce(v_member.activated_at, v_member.joined_at) at time zone 'America/Bogota')::date;
      v_days_present := least(7, greatest(0, (v_week_end - greatest(v_week_start, v_activated_date)) + 1));

      v_required := least(v_group.min_days_per_week, v_days_present);
      v_effective_required := greatest(v_required - v_vacation, 0);
      v_failed := greatest(v_effective_required - v_completed, 0);
      v_penalty := v_failed * v_group.penalty_amount;

      insert into weekly_evaluation_results (
        run_id, group_id, user_id, required_days, completed_days,
        vacation_days_used, failed_days, penalty_charged,
        balance_before, balance_after, status_after
      ) values (
        v_run_id, v_group.id, v_member.user_id, v_required, v_completed,
        v_vacation, v_failed, v_penalty, v_member.balance,
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

    update groups g
      set min_days_per_week = coalesce((p.proposed_changes ->> 'min_days_per_week')::int, g.min_days_per_week),
          penalty_amount = coalesce((p.proposed_changes ->> 'penalty_amount')::numeric, g.penalty_amount),
          vacation_days_per_month = coalesce((p.proposed_changes ->> 'vacation_days_per_month')::int, g.vacation_days_per_month)
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

-- ============================================================================
-- Photo retention: check-in photos are only kept for 7 days. The checkins
-- row (date/location/attendance record) stays forever for history and the
-- weekly evaluation audit trail — only the storage object is removed, so a
-- signed-URL request for an expired photo simply fails client-side.
-- ============================================================================
create or replace function cleanup_old_checkin_photos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from storage.objects
    where bucket_id = 'checkins'
      and name in (
        select photo_path from checkins
          where checkin_date < (now() at time zone 'America/Bogota')::date - 7
      );
end;
$$;

select cron.schedule(
  'cleanup-old-checkin-photos',
  '0 8 * * *', -- 03:00 America/Bogota daily
  $$select cleanup_old_checkin_photos();$$
);
