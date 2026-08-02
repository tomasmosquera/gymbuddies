-- ============================================================================
-- Group payout modes: how the group's pooled money gets distributed.
--
-- - 'cooperative' (default, matches today's already-intended-but-never-
--   implemented model): every active member has an equal 1/N share of the
--   pool; leaving now actually pays that share out (see 0063).
-- - 'league': the whole pool is split among the top places (by the existing
--   consistency ranking) at the end of a fixed-duration cycle.
-- - 'mixed': mixed_league_share_percent of the pool follows 'league',
--   the rest follows 'cooperative'.
--
-- These are ordinary rule fields from here on — flat scalar columns on
-- groups, flowing through the same generic propose/vote/apply-immediately-
-- or-apply-directly machinery as penalty_amount/exit_fee_amount/etc (see
-- 0063's extension of apply_rule_proposal/apply_rule_change_direct).
-- ============================================================================
alter table groups add column payout_mode text not null default 'cooperative'
  check (payout_mode in ('cooperative', 'league', 'mixed'));

alter table groups add column league_duration_months int not null default 3
  check (league_duration_months > 0 and league_duration_months <= 24);

-- Percent of the league-share pool each place gets, in order (1st, 2nd, ...).
-- Configurable length/values, e.g. [60,30,10] or [100] (winner-take-all).
-- Sum must not exceed 100 — a sum below 100 just leaves the remainder
-- unpaid in the pool, which is intentional (e.g. undersubscribed prize
-- pools, or a deliberate "keep some in reserve" choice).
--
-- Check constraints can't contain subqueries directly (Postgres restriction)
-- — jsonb_array_elements_text is a set-returning function, so the
-- validation has to live in a helper function instead.
create or replace function is_valid_prize_splits(p_splits jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_splits) = 'array'
    and coalesce((select bool_and((e)::numeric >= 0) from jsonb_array_elements_text(p_splits) e), true)
    and coalesce((select sum((e)::numeric) from jsonb_array_elements_text(p_splits) e), 0) <= 100;
$$;

alter table groups add column league_prize_splits jsonb not null default '[60, 30, 10]'::jsonb
  check (is_valid_prize_splits(league_prize_splits));

-- Only meaningful when payout_mode = 'mixed': what % of the pool follows
-- the league mechanic (the rest follows the cooperative mechanic).
alter table groups add column mixed_league_share_percent numeric(5, 2) not null default 50
  check (mixed_league_share_percent between 0 and 100);

-- ============================================================================
-- New wallet_transactions type for payout-mode money movement (see 0063).
-- First alteration of this constraint since the table's creation in 0004 —
-- still pure bookkeeping like every other type here, no real fund transfer.
-- ============================================================================
alter table wallet_transactions drop constraint wallet_transactions_type_check;
alter table wallet_transactions add constraint wallet_transactions_type_check
  check (type in ('initial_deposit', 'penalty', 'recharge', 'adjustment', 'payout'));

-- ============================================================================
-- League cycle state + history. A "cycle" snapshots its own duration/prize
-- splits/league-share-percent at start time — same snapshot idiom as
-- rule_proposals.member_count_snapshot — so a running cycle isn't silently
-- altered if the group's config changes (via rule-vote or direct admin
-- change) while it's in progress. At most one running cycle per group.
-- ============================================================================
create table league_cycles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  cycle_number int not null,
  prize_splits jsonb not null,
  duration_months int not null,
  league_share_percent numeric(5, 2) not null, -- 100 for pure 'league' mode
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'running' check (status in ('running', 'completed', 'cancelled')),
  completed_at timestamptz,
  pool_at_payout numeric(12, 2),
  created_at timestamptz not null default now(),
  unique (group_id, cycle_number)
);

create unique index one_running_league_cycle_per_group on league_cycles (group_id) where status = 'running';

create table league_cycle_payouts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references league_cycles (id) on delete cascade,
  user_id uuid not null references profiles (id),
  place int not null,
  share_percent numeric(5, 2) not null,
  amount numeric(12, 2) not null,
  wallet_transaction_id uuid references wallet_transactions (id),
  created_at timestamptz not null default now()
);

alter table league_cycles enable row level security;
alter table league_cycle_payouts enable row level security;

create policy league_cycles_select on league_cycles for select using (is_group_member(group_id));
create policy league_cycle_payouts_select on league_cycle_payouts for select
  using (exists (select 1 from league_cycles c where c.id = league_cycle_payouts.cycle_id and is_group_member(c.group_id)));

-- Written exclusively by SECURITY DEFINER functions (0063), same as
-- weekly_evaluation_runs/weekly_evaluation_results.
revoke insert, update, delete on league_cycles, league_cycle_payouts from authenticated;
