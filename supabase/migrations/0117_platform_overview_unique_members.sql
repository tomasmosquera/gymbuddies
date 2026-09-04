-- Adds total_active_unique_members: distinct people, not membership rows —
-- someone active in 3 groups counted once here instead of 3 times, unlike
-- total_active_members (which stays a raw membership-row count, still
-- useful on its own as "total seats filled" across the platform).
--
-- A `returns table` function's OUT-parameter row type can't just be
-- CREATE OR REPLACE'd into a different shape (Postgres: "cannot change
-- return type of existing function") — same overload-vs-signature-change
-- rule as any other function, drop first.
drop function if exists platform_admin_overview();

create or replace function platform_admin_overview()
returns table (
  total_groups bigint,
  active_groups bigint,
  total_active_members bigint,
  total_active_unique_members bigint,
  total_balance numeric,
  total_penalties_collected numeric,
  cooperative_count bigint,
  league_count bigint,
  mixed_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce((select is_platform_admin from profiles where id = auth.uid()), false) then
    raise exception 'only the platform admin can view this';
  end if;

  return query
  select
    (select count(*) from groups),
    (select count(*) from groups g
       where exists (
         select 1 from group_members gm
         where gm.group_id = g.id and gm.status in ('active', 'needs_recharge')
       )),
    (select count(*) from group_members where status in ('active', 'needs_recharge')),
    (select count(distinct user_id) from group_members where status in ('active', 'needs_recharge')),
    (select coalesce(sum(balance), 0) from group_members where status in ('active', 'needs_recharge')),
    (select coalesce(sum(penalty_charged), 0) from weekly_evaluation_results),
    (select count(*) from groups where payout_mode = 'cooperative'),
    (select count(*) from groups where payout_mode = 'league'),
    (select count(*) from groups where payout_mode = 'mixed');
end;
$$;
