-- ============================================================================
-- In-app notification history (Perfil > Notificaciones): up to now, every
-- notification only ever existed as a push sent through Expo's API — nothing
-- was stored, so there was no way to show "your last 20 notifications" in
-- the app itself. This adds that persistence, written by the same single
-- choke point (send_push_notification) every notification already goes
-- through, so no caller needs to change.
-- ============================================================================
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  group_id uuid not null references groups (id) on delete cascade,
  title text not null,
  body text not null,
  category text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx on notifications (user_id, created_at desc);

alter table notifications enable row level security;

create policy notifications_select on notifications
  for select
  using (user_id = auth.uid());

-- No insert/update/delete policies — only send_push_notification (service
-- definer) writes here, same as every other system-written table.
revoke insert, update, delete on notifications from authenticated;

-- A single "last opened the list" timestamp is enough to show a simple
-- unread dot on the bell icon and a "new" marker per item — no need for a
-- read_at column per notification for what's being asked here.
alter table profiles add column last_notifications_seen_at timestamptz;

create or replace function mark_notifications_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set last_notifications_seen_at = now() where id = auth.uid();
end;
$$;

-- ============================================================================
-- send_push_notification now determines the eligible recipient set (group
-- membership + category preference) up front — independent of whether they
-- have a push token registered — logs one notifications row per eligible
-- recipient, and only THEN narrows to whoever has a token to actually push
-- to. Someone who never registered a device still sees the notification the
-- next time they open the app.
-- ============================================================================
create or replace function send_push_notification(
  p_user_ids uuid[], p_title text, p_body text, p_group_id uuid,
  p_data jsonb default '{}'::jsonb, p_category text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eligible_user_ids uuid[];
  v_messages jsonb;
begin
  select array_agg(gm.user_id) into v_eligible_user_ids
    from group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = any(p_user_ids)
      and (p_category is null or coalesce((gm.notification_preferences ->> p_category)::boolean, true));

  if v_eligible_user_ids is null then
    return;
  end if;

  insert into notifications (user_id, group_id, title, body, category, data)
    select uid, p_group_id, p_title, p_body, p_category, p_data
    from unnest(v_eligible_user_ids) as uid;

  select jsonb_agg(jsonb_build_object(
    'to', pt.token, 'sound', 'default', 'title', p_title, 'body', p_body, 'data', p_data
  ))
  into v_messages
  from push_tokens pt
  where pt.user_id = any(v_eligible_user_ids);

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
