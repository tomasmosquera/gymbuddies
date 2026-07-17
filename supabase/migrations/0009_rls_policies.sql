-- ============================================================================
-- Column-level grants: RLS gates ROWS, not columns. Supabase's default
-- privileges grant authenticated full column access on every new table, so
-- for the tables holding money/authority-sensitive fields we explicitly
-- narrow what a direct client UPDATE may touch. Fields outside this list
-- (balance, confirmed_by/confirmed_at, rule fields on groups, ...) can then
-- only ever change via the SECURITY DEFINER functions in 0007/0008, which
-- run as the table owner and are unaffected by these grants.
-- ============================================================================
revoke update on groups from authenticated;
grant update (name, admin_payment_info) on groups to authenticated;

revoke update on group_members from authenticated;
grant update (role, status) on group_members to authenticated;

revoke update on wallet_transactions from authenticated;
grant update (status) on wallet_transactions to authenticated;

revoke update on rule_proposals from authenticated;
grant update (status) on rule_proposals to authenticated;

-- checkins, vacation_days, weekly_evaluation_* stay fully un-updatable
-- (immutable proof / audit trail) — no update grant at all.
revoke update on checkins from authenticated;
revoke update on vacation_days from authenticated;
revoke update on weekly_evaluation_runs from authenticated;
revoke update on weekly_evaluation_results from authenticated;
revoke update on rule_votes from authenticated;

-- Direct inserts are blocked wherever an RPC is the required path.
revoke insert on groups from authenticated;
revoke insert on group_members from authenticated;
revoke insert on rule_proposals from authenticated;
revoke insert on rule_votes from authenticated;
revoke insert on weekly_evaluation_runs from authenticated;
revoke insert on weekly_evaluation_results from authenticated;

revoke delete on groups, group_members, checkins, vacation_days, wallet_transactions,
  rule_proposals, rule_votes, weekly_evaluation_runs, weekly_evaluation_results
  from authenticated;

-- ============================================================================
-- profiles
-- ============================================================================
create or replace function shares_group_with(p_other_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members a
    join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = p_other_user
  );
$$;

create policy profiles_select on profiles
  for select
  using (id = auth.uid() or shares_group_with(id));

create policy profiles_update_own on profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================================
-- groups
-- ============================================================================
create policy groups_select on groups
  for select
  using (is_group_member(id));

create policy groups_update_admin on groups
  for update
  using (is_group_admin(id))
  with check (is_group_admin(id));

-- ============================================================================
-- group_members
-- ============================================================================
create policy group_members_select on group_members
  for select
  using (is_group_member(group_id));

create policy group_members_update_admin on group_members
  for update
  using (is_group_admin(group_id))
  with check (is_group_admin(group_id));

-- ============================================================================
-- checkins — proof of a workout, immutable once written.
-- ============================================================================
create policy checkins_select on checkins
  for select
  using (is_group_member(group_id));

create policy checkins_insert_self on checkins
  for insert
  with check (user_id = auth.uid() and is_voting_member(group_id, auth.uid()));

-- ============================================================================
-- vacation_days
-- ============================================================================
create policy vacation_days_select on vacation_days
  for select
  using (is_group_member(group_id));

create policy vacation_days_insert_self on vacation_days
  for insert
  with check (user_id = auth.uid() and is_voting_member(group_id, auth.uid()));

-- ============================================================================
-- wallet_transactions
-- ============================================================================
create policy wallet_transactions_select on wallet_transactions
  for select
  using (is_group_member(group_id));

-- Self-service: only deposits/recharges, and always starting pending —
-- confirmation is a separate, admin-only step.
create policy wallet_transactions_insert_self on wallet_transactions
  for insert
  with check (
    user_id = auth.uid()
    and type in ('initial_deposit', 'recharge')
    and status = 'pending'
    and is_group_member(group_id)
  );

-- Admin can record a transaction already confirmed (e.g. cash handed over
-- in person) but never fabricate a system 'penalty' row.
create policy wallet_transactions_insert_admin on wallet_transactions
  for insert
  with check (
    is_group_admin(group_id)
    and type in ('initial_deposit', 'recharge', 'adjustment')
  );

create policy wallet_transactions_update_admin on wallet_transactions
  for update
  using (is_group_admin(group_id) and status = 'pending')
  with check (is_group_admin(group_id) and status in ('confirmed', 'rejected'));

-- ============================================================================
-- rule_proposals
-- ============================================================================
create policy rule_proposals_select on rule_proposals
  for select
  using (is_group_member(group_id));

create policy rule_proposals_cancel_admin on rule_proposals
  for update
  using (is_group_admin(group_id) and status = 'pending')
  with check (is_group_admin(group_id) and status = 'cancelled');

-- ============================================================================
-- rule_votes — writes only via the cast_vote() RPC (security definer).
-- ============================================================================
create policy rule_votes_select on rule_votes
  for select
  using (
    exists (
      select 1 from rule_proposals p
      where p.id = rule_votes.proposal_id and is_group_member(p.group_id)
    )
  );

-- ============================================================================
-- weekly_evaluation_runs / weekly_evaluation_results — system-written only.
-- ============================================================================
create policy weekly_evaluation_runs_select on weekly_evaluation_runs
  for select
  using (is_group_member(group_id));

create policy weekly_evaluation_results_select on weekly_evaluation_results
  for select
  using (is_group_member(group_id));
