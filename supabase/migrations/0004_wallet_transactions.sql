-- Single source of truth for every balance-affecting event: the initial
-- deposit, a recharge, or a system-generated penalty. amount is signed
-- (+deposit/+recharge, -penalty) so group_members.balance is always the
-- sum of confirmed transactions (enforced by the trigger in 0008).
create table wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  type text not null check (type in ('initial_deposit', 'penalty', 'recharge', 'adjustment')),
  amount numeric(12, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  receipt_path text,
  confirmed_by uuid references profiles (id),
  confirmed_at timestamptz,
  weekly_evaluation_result_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index wallet_transactions_group_user_idx on wallet_transactions (group_id, user_id);
create index wallet_transactions_pending_idx on wallet_transactions (group_id, status) where status = 'pending';

alter table wallet_transactions enable row level security;
