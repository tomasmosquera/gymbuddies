-- ============================================================================
-- "Bud" — a lightweight, person-to-person nudge: "avisale a X que vaya al
-- gym". Deliberately NOT a chat/message system, just a push. Rate-limited to
-- 2 per (sender, recipient) per group per day so it can't become spam —
-- enforced server-side (the real authority) via a count check inside the
-- same RPC that does the insert, same pattern submit_koth_claim/
-- submit_checkin already use for their own guards.
-- ============================================================================
create table buddy_nudges (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  sender_id uuid not null references profiles (id) on delete cascade,
  recipient_id uuid not null references profiles (id) on delete cascade,
  sent_at timestamptz not null default now(),
  -- Local calendar date in the GROUP's timezone (not sender's device time) —
  -- same reasoning as checkins.checkin_date: the "day" a nudge counts
  -- against has to be the group's own day, not wherever the sender happens
  -- to be standing.
  sent_date date not null
);

create index buddy_nudges_rate_limit_idx on buddy_nudges (group_id, sender_id, recipient_id, sent_date);

alter table buddy_nudges enable row level security;

-- Read-only for your own sent nudges (so the client can show "ya le
-- avisaste hoy" / "1 de 2" before even trying) — no policy at all for
-- reading nudges sent BY someone else, and no insert/update/delete policy
-- for anyone: every write goes through send_buddy_nudge below.
create policy buddy_nudges_select_own on buddy_nudges
  for select using (sender_id = auth.uid());

-- ============================================================================
-- send_buddy_nudge: validates both people are real, active-ish members of
-- the same group (never yourself), enforces the 2/day/pair cap, inserts,
-- and pushes — reusing the 'reminders' notification category (a nudge IS a
-- reminder, just from a teammate instead of the system), so it automatically
-- respects whatever the recipient already set for reminder pushes and needs
-- no new preferences-screen toggle.
-- ============================================================================
create or replace function send_buddy_nudge(p_group_id uuid, p_recipient_id uuid)
returns buddy_nudges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_count int;
  v_nudge buddy_nudges%rowtype;
  v_sender_name text;
  v_recipient_active boolean;
begin
  if auth.uid() = p_recipient_id then
    raise exception 'no podés avisarte a vos mismo';
  end if;
  if not is_group_member(p_group_id) then
    raise exception 'no sos miembro de este grupo';
  end if;

  select exists (
    select 1 from group_members
    where group_id = p_group_id and user_id = p_recipient_id
      and status in ('pending_deposit', 'active', 'needs_recharge')
  ) into v_recipient_active;
  if not v_recipient_active then
    raise exception 'esa persona no está participando activamente en el grupo';
  end if;

  select timezone into v_tz from groups where id = p_group_id;
  v_today := (now() at time zone v_tz)::date;

  select count(*) into v_count
    from buddy_nudges
    where group_id = p_group_id and sender_id = auth.uid() and recipient_id = p_recipient_id and sent_date = v_today;
  if v_count >= 2 then
    raise exception 'ya le avisaste 2 veces hoy a esta persona';
  end if;

  insert into buddy_nudges (group_id, sender_id, recipient_id, sent_at, sent_date)
    values (p_group_id, auth.uid(), p_recipient_id, now(), v_today)
    returning * into v_nudge;

  select full_name into v_sender_name from profiles where id = auth.uid();
  perform send_push_notification(
    array[p_recipient_id], 'Gym Buddies',
    format('%s te está avisando: ¡vamos al gym! 💪', coalesce(v_sender_name, 'Un compañero')),
    p_group_id, p_category => 'reminders'
  );

  return v_nudge;
end;
$$;
