-- ============================================================================
-- app_version_info: lets the client detect "I'm on an old native build" and
-- prompt the user to update, without needing an app update/build of its own
-- to take effect — the developer just updates a row here by hand (SQL or
-- the Supabase dashboard) right after cutting a new native build. Every
-- install still on an older runtimeVersion (which an eas update can never
-- reach, since OTA updates only ever deliver to matching runtime versions)
-- picks this up the next time it opens and compares its own frozen
-- Updates.runtimeVersion against latest_version here.
--
-- One row per platform (not a single global value) since iOS/Android release
-- cadence can differ in practice — e.g. this app's Android build isn't even
-- published yet while iOS already is.
--
-- Publicly readable (no auth required — the check has to work even before
-- sign-in) and only ever admin-maintained directly against the database, so
-- no client write policy is granted at all.
-- ============================================================================
create table app_version_info (
  platform text primary key check (platform in ('ios', 'android')),
  latest_version text not null,
  store_url text,
  message text,
  updated_at timestamptz not null default now()
);

alter table app_version_info enable row level security;

create policy app_version_info_select on app_version_info
  for select
  using (true);

-- Seeded to the current build so nobody sees a false "please update" the
-- moment this ships — bump these by hand after every future native build.
insert into app_version_info (platform, latest_version, store_url) values
  ('ios', '1.0.2', 'https://apps.apple.com/app/idPLACEHOLDER'),
  ('android', '1.0.2', 'https://play.google.com/store/apps/details?id=com.gymbuddies.app');
