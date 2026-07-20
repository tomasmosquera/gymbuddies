-- ============================================================================
-- excuse_requests: header for a travel/medical/other excuse. travel and
-- medical require proof and are admin-approved/rejected (no group vote);
-- other has no proof requirement and instead goes through the same
-- majority-vote mechanism style as rule_proposals (required_votes/
-- member_count_snapshot/voting_closes_at are populated only for 'other').
-- ============================================================================
create table excuse_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  excuse_type text not null check (excuse_type in ('travel', 'medical', 'other')),
  requested_start_date date not null,
  requested_end_date date not null check (requested_end_date >= requested_start_date),
  reason text,
  proof_path text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decision_note text,
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  required_votes int,
  member_count_snapshot int,
  voting_closes_at timestamptz,
  created_at timestamptz not null default now()
);

create index excuse_requests_group_user_idx on excuse_requests (group_id, user_id);
create index excuse_requests_pending_idx on excuse_requests (group_id, status) where status = 'pending';

-- Only one open group vote for 'other' at a time (mirrors
-- one_pending_proposal_per_group). Travel/medical requests are reviewed
-- individually by the admin and are not similarly limited — several can be
-- pending in the admin's queue at once.
create unique index one_pending_other_excuse_per_group
  on excuse_requests (group_id)
  where status = 'pending' and excuse_type = 'other';

-- ============================================================================
-- excuse_dates: the ONLY table run_weekly_evaluation reads for excused days —
-- a direct replacement shape for the old vacation_days (row per excused
-- date). Populated by approve_excuse_request() (travel/medical, admin-picked
-- subset) or by the vote-resolution triggers (other, full requested range).
-- ============================================================================
create table excuse_dates (
  id uuid primary key default gen_random_uuid(),
  excuse_request_id uuid not null references excuse_requests (id) on delete cascade,
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  excused_date date not null,
  created_at timestamptz not null default now(),
  unique (group_id, user_id, excused_date)
);

create index excuse_dates_group_user_date_idx on excuse_dates (group_id, user_id, excused_date);

create table excuse_votes (
  id uuid primary key default gen_random_uuid(),
  excuse_request_id uuid not null references excuse_requests (id) on delete cascade,
  user_id uuid not null references profiles (id),
  vote text not null check (vote in ('yes', 'no')),
  voted_at timestamptz not null default now(),
  unique (excuse_request_id, user_id)
);

alter table excuse_requests enable row level security;
alter table excuse_dates enable row level security;
alter table excuse_votes enable row level security;

-- ============================================================================
-- Legacy data migration: bring forward every existing vacation_days row
-- (including the current, not-yet-evaluated week) as an already-approved
-- 'other'-type excuse, so the swapped-in run_weekly_evaluation query doesn't
-- silently retro-penalize anyone for a day they already banked. Grouped one
-- synthetic request per (group, user) to avoid one-row-per-day noise; the
-- decision_note records the provenance.
-- ============================================================================
insert into excuse_requests (
  group_id, user_id, excuse_type, requested_start_date, requested_end_date,
  reason, status, decision_note, decided_at, created_at
)
select
  group_id, user_id, 'other',
  min(vacation_date), max(vacation_date),
  'Migrated from legacy vacation_days table',
  'approved', 'Auto-approved: pre-existing vacation day(s) migrated during the excuse-system rollout.',
  now(), now()
from vacation_days
group by group_id, user_id;

insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
select r.id, v.group_id, v.user_id, v.vacation_date
from vacation_days v
join excuse_requests r
  on r.group_id = v.group_id and r.user_id = v.user_id
  and r.decision_note = 'Auto-approved: pre-existing vacation day(s) migrated during the excuse-system rollout.'
on conflict (group_id, user_id, excused_date) do nothing;

drop table vacation_days;

-- ============================================================================
-- weekly_evaluation_results: rename the column to reflect that it now counts
-- any approved excuse type, not just "vacation".
-- ============================================================================
alter table weekly_evaluation_results rename column vacation_days_used to excused_days_used;

-- ============================================================================
-- RLS: reads open to any group member; ALL writes go through the RPCs in
-- 0015 (security definer) — no direct insert/update policy for clients.
-- ============================================================================
create policy excuse_requests_select on excuse_requests
  for select
  using (is_group_member(group_id));

create policy excuse_dates_select on excuse_dates
  for select
  using (is_group_member(group_id));

create policy excuse_votes_select on excuse_votes
  for select
  using (
    exists (
      select 1 from excuse_requests r
      where r.id = excuse_votes.excuse_request_id and is_group_member(r.group_id)
    )
  );

revoke insert, update, delete on excuse_requests from authenticated;
revoke insert, update, delete on excuse_dates from authenticated;
revoke insert, update, delete on excuse_votes from authenticated;
