-- ============================================================================
-- Weekly penalty cap: NOT NULL, no nullable "uncapped" sentinel (that would
-- collide with "cap at zero" and complicate every LEAST() call site).
-- Existing groups are backfilled to the highest amount they could ever be
-- charged in a week (7 possible failed days * their own penalty_amount) —
-- an exact behavioral no-op until an admin proposes a real (lower) cap via
-- propose_rule_change.
-- ============================================================================
alter table groups add column weekly_penalty_cap numeric(12, 2);
update groups set weekly_penalty_cap = 7 * penalty_amount;
alter table groups alter column weekly_penalty_cap set not null;
alter table groups add constraint groups_weekly_penalty_cap_check check (weekly_penalty_cap >= 0);

-- ============================================================================
-- Exit fee / notice period: brand new concept, no prior equivalent, so both
-- default to 0 for every existing (and new-unless-specified) group — this
-- preserves leave_group's current behavior (instant, free exit) until an
-- admin explicitly proposes real values (e.g. $500k / 30 days).
-- ============================================================================
alter table groups add column exit_fee_amount numeric(12, 2) not null default 0 check (exit_fee_amount >= 0);
alter table groups add column exit_notice_days int not null default 0 check (exit_notice_days >= 0);

-- ============================================================================
-- Remove the old single-bucket monthly vacation cap entirely — replaced by
-- the unlimited-with-proof excuse system (0014/0015).
-- ============================================================================
drop trigger if exists trg_vacation_cap on vacation_days;
drop function if exists check_vacation_cap();
alter table groups drop column vacation_days_per_month;

-- ============================================================================
-- Leave-group notice tracking. No new group_members.status value needed: a
-- member serving notice stays 'active'/'needs_recharge' and is graded
-- normally the whole time — these two columns just remember when notice was
-- given and when it takes effect (flipped to 'left' by the hourly sweep in
-- 0015/0017).
-- ============================================================================
alter table group_members add column leave_requested_at timestamptz;
alter table group_members add column leave_effective_at timestamptz;

create index group_members_pending_leave_idx on group_members (leave_effective_at)
  where leave_effective_at is not null and status not in ('left', 'removed');
