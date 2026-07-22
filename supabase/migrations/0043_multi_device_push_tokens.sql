-- ============================================================================
-- Root cause of "notifications go to Expo Go instead of TestFlight": a push
-- token is scoped to one specific device+app+push-credentials combination —
-- Expo Go and a standalone/TestFlight build can never share one, even on
-- the same physical device with the same account. profiles.expo_push_token
-- was a single column, so whichever app last called
-- registerForPushNotificationsAsync() overwrote the other's token, and only
-- that one app kept receiving pushes from then on.
--
-- Fixed by moving to a proper one-user-to-many-tokens table instead. A
-- physical device/install is identified by its token, so a token is
-- reassigned to whoever last registered it (on conflict do update), letting
-- the same device be reused across accounts (e.g. someone signs out and a
-- teammate signs in) without ever accumulating a stale duplicate.
-- send_push_notification now fans out to every token belonging to a user
-- instead of the single profiles column, so notifications reach every
-- device (Expo Go AND TestFlight, or an old phone AND a new one) at once.
-- ============================================================================
create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

alter table push_tokens enable row level security;
-- No policies: every write goes through register_push_token /
-- unregister_push_token (security definer), same "RPC-only" pattern as
-- checkins/group_members — there's no legitimate direct-table use case here.

create or replace function register_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into push_tokens (user_id, token)
    values (auth.uid(), p_token)
  on conflict (token) do update set user_id = excluded.user_id;
end;
$$;

create or replace function unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from push_tokens where token = p_token and user_id = auth.uid();
end;
$$;

create or replace function send_push_notification(
  p_user_ids uuid[], p_title text, p_body text, p_data jsonb default '{}'::jsonb, p_category text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_messages jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'to', pt.token, 'sound', 'default', 'title', p_title, 'body', p_body, 'data', p_data
  ))
  into v_messages
  from push_tokens pt
  join profiles p on p.id = pt.user_id
  where pt.user_id = any(p_user_ids)
    and (p_category is null or coalesce((p.notification_preferences ->> p_category)::boolean, true));

  if v_messages is null or jsonb_array_length(v_messages) = 0 then
    return;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object('content-type', 'application/json'),
    body := v_messages
  );
end;
$$;

alter table profiles drop column expo_push_token;
