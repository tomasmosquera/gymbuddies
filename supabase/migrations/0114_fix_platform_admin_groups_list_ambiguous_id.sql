-- ============================================================================
-- Fix: platform_admin_groups_list()'s `returns table` has an `id` output
-- column, which PL/pgSQL also exposes as a variable name inside the function
-- body — the admin check's `where id = auth.uid()` (copied from
-- platform_admin_overview, whose OUT columns don't happen to collide) was
-- ambiguous between that variable and profiles.id, raising "column
-- reference \"id\" is ambiguous" on every call. Qualified explicitly below;
-- everything else in the function was already alias-qualified.
-- ============================================================================
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
  if not coalesce((select p2.is_platform_admin from profiles p2 where p2.id = auth.uid()), false) then
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
