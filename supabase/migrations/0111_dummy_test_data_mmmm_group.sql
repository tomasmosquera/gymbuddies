-- ============================================================================
-- ONE-OFF TEST DATA — NOT a schema change. Seeds 4 synthetic members
-- ("Jugador Dummy 1".."4") into the group named 'Mmmm' with a mix of
-- checked-in / excused / failed days this week, purely so the admin_only
-- per-member week view (app/(app)/home/index.tsx) can be eyeballed in the
-- real app instead of guessed at.
--
-- Synthetic auth.users rows are inserted directly (bypassing GoTrue sign-up)
-- since profiles.id is a hard FK to auth.users — the existing
-- on_auth_user_created trigger (0001) then auto-creates each profiles row
-- from raw_user_meta_data.full_name. These accounts have no push token and
-- checkins are inserted directly into the table (not via submit_checkin/
-- submit_workout_checkout), so no push notification fires for any of this
-- (those RPCs are the only place send_push_notification is called for
-- checkins — a raw insert skips them entirely).
--
-- Cleanup (run whenever this is done being useful — safe to run as one
-- statement, cascades through group_members/checkins/excuse_dates/profiles
-- via ON DELETE CASCADE):
--   delete from auth.users where email like '%@gymbuddies.test';
-- ============================================================================
do $$
declare
  v_group_id uuid;
  v_admin_id uuid;
  v_tz text;
  v_deposit numeric;
  v_week_start date;
  v_mon timestamptz;
  v_tue timestamptz;
  v_wed timestamptz;
  v_user_ids uuid[] := '{}';
  v_uid uuid;
  v_excuse_request_id uuid;
  i int;
  v_names text[] := array['Jugador Dummy 1', 'Jugador Dummy 2', 'Jugador Dummy 3', 'Jugador Dummy 4'];
begin
  select id, admin_id, timezone, initial_deposit_amount into v_group_id, v_admin_id, v_tz, v_deposit
    from groups where name = 'Mmmm' limit 1;

  if v_group_id is null then
    raise exception 'No existe un grupo llamado ''Mmmm''';
  end if;

  v_week_start := date_trunc('week', now() at time zone v_tz)::date;
  v_mon := (v_week_start::timestamp + interval '8 hours') at time zone v_tz;
  v_tue := ((v_week_start + 1)::timestamp + interval '8 hours') at time zone v_tz;
  v_wed := ((v_week_start + 2)::timestamp + interval '8 hours') at time zone v_tz;

  -- set_checkin_date() (0092) requires auth.uid() = the checkin's own user_id
  -- (with a clock-drift check) or the group admin (no drift check — the
  -- sanctioned "backfill" path). The SQL Editor has no auth.uid() at all, so
  -- impersonate the group admin via the JWT claim GUC (transaction-local —
  -- set_config's third arg `true` — so it's gone once this block finishes).
  -- Both claim shapes are set since which one auth.uid() reads depends on
  -- the platform's GoTrue version.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);

  -- 4 synthetic auth users -> profiles (via existing handle_new_user trigger).
  for i in 1..4 loop
    -- Existence check rather than ON CONFLICT (email) — avoids depending on
    -- knowing GoTrue's exact unique-index shape on auth.users.email, which
    -- has changed across Supabase versions. Re-running this file is then
    -- still safe: it reuses the same id instead of erroring or duplicating.
    select id into v_uid from auth.users where email = format('dummy%s@gymbuddies.test', i);
    if v_uid is null then
      v_uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
        format('dummy%s@gymbuddies.test', i),
        '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01',
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('full_name', v_names[i]),
        '', '', '', ''
      );
    end if;
    v_user_ids := v_user_ids || v_uid;

    insert into group_members (group_id, user_id, role, status, balance, joined_at, activated_at)
      values (v_group_id, v_uid, 'member', 'active', v_deposit, now() - interval '30 days', now() - interval '30 days')
      on conflict (group_id, user_id) do nothing;
  end loop;

  -- Player 1: checked in all 3 decided days so far this week -> all ✓.
  insert into checkins (group_id, user_id, captured_at, latitude, longitude, photo_path)
    values
      (v_group_id, v_user_ids[1], v_mon, 4.6097, -74.0817, 'dummy/seed-data.jpg'),
      (v_group_id, v_user_ids[1], v_tue, 4.6097, -74.0817, 'dummy/seed-data.jpg'),
      (v_group_id, v_user_ids[1], v_wed, 4.6097, -74.0817, 'dummy/seed-data.jpg')
    on conflict (group_id, user_id, checkin_date) do nothing;

  -- Player 2: missed Tuesday -> ✓ ✗ ✓.
  insert into checkins (group_id, user_id, captured_at, latitude, longitude, photo_path)
    values
      (v_group_id, v_user_ids[2], v_mon, 4.6097, -74.0817, 'dummy/seed-data.jpg'),
      (v_group_id, v_user_ids[2], v_wed, 4.6097, -74.0817, 'dummy/seed-data.jpg')
    on conflict (group_id, user_id, checkin_date) do nothing;

  -- Player 3: Tuesday excused (approved 'other' request) -> ✓ – ✓.
  insert into checkins (group_id, user_id, captured_at, latitude, longitude, photo_path)
    values
      (v_group_id, v_user_ids[3], v_mon, 4.6097, -74.0817, 'dummy/seed-data.jpg'),
      (v_group_id, v_user_ids[3], v_wed, 4.6097, -74.0817, 'dummy/seed-data.jpg')
    on conflict (group_id, user_id, checkin_date) do nothing;

  if not exists (
    select 1 from excuse_dates
    where group_id = v_group_id and user_id = v_user_ids[3] and excused_date = v_week_start + 1
  ) then
    insert into excuse_requests (
      group_id, user_id, excuse_type, requested_start_date, requested_end_date,
      reason, status, decided_by, decided_at
    ) values (
      v_group_id, v_user_ids[3], 'other', v_week_start + 1, v_week_start + 1,
      'Excusa de prueba (datos dummy)', 'approved', v_admin_id, now()
    ) returning id into v_excuse_request_id;

    insert into excuse_dates (excuse_request_id, group_id, user_id, excused_date)
      values (v_excuse_request_id, v_group_id, v_user_ids[3], v_week_start + 1);
  end if;

  -- Player 4: no check-ins at all -> ✗ ✗ (Mon/Tue already decided), today
  -- (Wed) stays blank/neutral until the day is actually over — same rule
  -- classifyMemberDay applies to every real member.
end $$;
