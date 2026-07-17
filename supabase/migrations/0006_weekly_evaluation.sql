-- Audit trail of every weekly evaluation run, one row per group per week,
-- guarding idempotency: the run row is inserted first, so re-invoking the
-- job for a week that already ran hits the unique constraint and aborts.
create table weekly_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  week_start_date date not null,
  week_end_date date not null,
  ran_at timestamptz not null default now(),
  unique (group_id, week_start_date)
);

create table weekly_evaluation_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references weekly_evaluation_runs (id) on delete cascade,
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  required_days int not null,
  completed_days int not null,
  vacation_days_used int not null,
  failed_days int not null,
  penalty_charged numeric(12, 2) not null,
  balance_before numeric(12, 2) not null,
  balance_after numeric(12, 2) not null,
  status_after text not null check (status_after in ('active', 'needs_recharge')),
  created_at timestamptz not null default now(),
  unique (group_id, user_id, run_id)
);

alter table wallet_transactions
  add constraint wallet_transactions_eval_fk
  foreign key (weekly_evaluation_result_id) references weekly_evaluation_results (id);

alter table weekly_evaluation_runs enable row level security;
alter table weekly_evaluation_results enable row level security;
