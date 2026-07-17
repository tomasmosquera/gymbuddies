-- A proposed change to a group's rules (min days/week, penalty amount,
-- vacation days/month). Only fields being changed appear in proposed_changes.
create table rule_proposals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  proposed_by uuid not null references profiles (id),
  proposed_changes jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'applied')),
  required_votes int not null,
  member_count_snapshot int not null,
  voting_closes_at timestamptz not null,
  decided_at timestamptz,
  effective_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

-- Only one open vote per group at a time keeps the majority math unambiguous.
create unique index one_pending_proposal_per_group
  on rule_proposals (group_id)
  where status = 'pending';

create table rule_votes (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references rule_proposals (id) on delete cascade,
  user_id uuid not null references profiles (id),
  vote text not null check (vote in ('yes', 'no')),
  voted_at timestamptz not null default now(),
  unique (proposal_id, user_id)
);

alter table rule_proposals enable row level security;
alter table rule_votes enable row level security;
