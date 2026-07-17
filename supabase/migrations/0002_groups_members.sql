-- A group is one accountability circle with its own rules and invite code.
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  admin_id uuid not null references profiles (id),
  currency text not null default 'COP',
  initial_deposit_amount numeric(12, 2) not null check (initial_deposit_amount > 0),
  min_days_per_week int not null check (min_days_per_week between 0 and 7),
  penalty_amount numeric(12, 2) not null check (penalty_amount >= 0),
  vacation_days_per_month int not null default 0 check (vacation_days_per_month >= 0),
  admin_payment_info text,
  timezone text not null default 'America/Bogota',
  created_at timestamptz not null default now()
);

-- Membership + running balance for one user in one group.
create table group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending_deposit'
    check (status in ('pending_deposit', 'active', 'needs_recharge', 'left', 'removed')),
  balance numeric(12, 2) not null default 0,
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index group_members_user_idx on group_members (user_id);
create index group_members_group_status_idx on group_members (group_id, status);

alter table groups enable row level security;
alter table group_members enable row level security;
