-- ============================================================================
-- Platform admin meta panel: two read-only RPCs giving the platform admin
-- (profiles.is_platform_admin — see 0089_public_groups.sql) a cross-group
-- view that no RLS policy could safely expose directly (a regular member
-- can only ever see their own groups). Both raise instead of silently
-- returning zero rows for a non-platform-admin caller, same as every other
-- admin-gated RPC in this app.
-- ============================================================================
create or replace function platform_admin_overview()
returns table (
  total_groups bigint,
  active_groups bigint,
  total_active_members bigint,
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
    (select coalesce(sum(balance), 0) from group_members where status in ('active', 'needs_recharge')),
    (select coalesce(sum(penalty_charged), 0) from weekly_evaluation_results),
    (select count(*) from groups where payout_mode = 'cooperative'),
    (select count(*) from groups where payout_mode = 'league'),
    (select count(*) from groups where payout_mode = 'mixed');
end;
$$;

-- Per-group row for the panel's group list — last_checkin_at is what lets
-- the client flag a group as gone quiet (no real activity recently) without
-- a separate query per group.
create or replace function platform_admin_groups_list()
returns table (
  id uuid,
  name text,
  payout_mode text,
  currency text,
  created_at timestamptz,
  admin_name text,
  active_member_count bigint,
  total_balance numeric,
  last_checkin_at timestamptz
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
    g.id, g.name, g.payout_mode, g.currency, g.created_at,
    p.full_name,
    (select count(*) from group_members gm where gm.group_id = g.id and gm.status in ('active', 'needs_recharge')),
    (select coalesce(sum(balance), 0) from group_members gm where gm.group_id = g.id and gm.status in ('active', 'needs_recharge')),
    (select max(captured_at) from checkins c where c.group_id = g.id)
  from groups g
  left join profiles p on p.id = g.admin_id
  order by g.created_at desc;
end;
$$;
