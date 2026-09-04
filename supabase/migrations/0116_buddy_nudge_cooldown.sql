-- ============================================================================
-- Bud gets a 12h cooldown on top of the existing 2/day cap: after nudging
-- someone, that same (sender, recipient) pair can't nudge again until 12h
-- have passed since the LAST nudge — regardless of calendar day, so a nudge
-- sent late one day still blocks a same-morning repeat the next. The 2/day
-- cap (by the group's own calendar day, unchanged) still applies on top —
-- whichever of the two blocks first wins.
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
  v_last_sent_at timestamptz;
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

  select max(sent_at) into v_last_sent_at
    from buddy_nudges
    where group_id = p_group_id and sender_id = auth.uid() and recipient_id = p_recipient_id;
  if v_last_sent_at is not null and now() - v_last_sent_at < interval '12 hours' then
    raise exception 'todavía está en espera — podés volver a avisarle en % horas',
      ceil(extract(epoch from (v_last_sent_at + interval '12 hours' - now())) / 3600);
  end if;

  insert into buddy_nudges (group_id, sender_id, recipient_id, sent_at, sent_date)
    values (p_group_id, auth.uid(), p_recipient_id, now(), v_today)
    returning * into v_nudge;

  select full_name into v_sender_name from profiles where id = auth.uid();
  perform send_push_notification(
    array[p_recipient_id], 'Gym Buddies',
    format('%s te está avisando: ¡vamos al gym! 💪🏼', coalesce(v_sender_name, 'Un compañero')),
    p_group_id, p_category => 'reminders'
  );

  return v_nudge;
end;
$$;
