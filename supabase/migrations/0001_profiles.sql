-- Profiles mirror auth.users with the app-specific fields we collect at sign-up.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  avatar_url text,
  expo_push_token text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Auto-create a profile row right after Supabase Auth creates the user,
-- using the full_name/phone passed in as sign-up metadata.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Sin nombre'),
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
