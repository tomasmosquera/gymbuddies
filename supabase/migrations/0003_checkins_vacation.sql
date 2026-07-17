-- One verified gym check-in. checkin_date is server-derived (see 0008 trigger),
-- never trusted from the client, so a user cannot backdate/forward-date a check-in.
create table checkins (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  -- NOT NULL is safe even though clients never set it: the BEFORE INSERT
  -- trigger (0008) derives it from captured_at before the constraint runs.
  checkin_date date not null,
  captured_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  location_accuracy_m double precision,
  photo_path text not null,
  created_at timestamptz not null default now(),
  unique (group_id, user_id, checkin_date)
);

create index checkins_group_user_date_idx on checkins (group_id, user_id, checkin_date);

-- An excused absence that counts toward the required days for that week,
-- capped per calendar month by groups.vacation_days_per_month.
create table vacation_days (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  vacation_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (group_id, user_id, vacation_date)
);

create index vacation_days_group_user_date_idx on vacation_days (group_id, user_id, vacation_date);

alter table checkins enable row level security;
alter table vacation_days enable row level security;
