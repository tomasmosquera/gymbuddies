-- ============================================================================
-- get_group_invite_preview: lets someone who ISN'T a group member yet (the
-- whole point of an invite) see just enough to decide whether to join —
-- name, member count, and the basic rules. groups_select RLS
-- (0009_rls_policies.sql) requires is_group_member(id), so a plain select
-- can't do this; this is a narrow, read-only SECURITY DEFINER escape hatch.
-- Deliberately excludes balances, admin_payment_info, and the member list.
-- Callable by anon (no execute revoke) — a not-yet-signed-up user opening
-- an invite link needs this before they even have a session.
-- ============================================================================
create or replace function get_group_invite_preview(p_invite_code text)
returns table(
  group_id uuid,
  name text,
  member_count int,
  min_days_per_week int,
  penalty_amount numeric,
  currency text,
  payout_mode text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    g.id,
    g.name,
    (select count(*)::int from group_members gm where gm.group_id = g.id and gm.status in ('active', 'needs_recharge')),
    g.min_days_per_week,
    g.penalty_amount,
    g.currency,
    g.payout_mode
  from groups g
  where g.invite_code = upper(trim(p_invite_code));
$$;
