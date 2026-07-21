-- ============================================================================
-- create_photo_challenge: a reason is now required — so the rest of the
-- group can actually understand why a vote was opened, instead of seeing a
-- bare "someone challenged this check-in." Enforced here (not just in the
-- client) since this is a SECURITY DEFINER RPC anyone could call directly.
-- ============================================================================
create or replace function create_photo_challenge(p_checkin_id uuid, p_reason text default null)
returns photo_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_member_count int;
  v_challenge photo_challenges%rowtype;
  v_recipient_ids uuid[];
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to challenge a photo';
  end if;
  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_voting_member(v_checkin.group_id, auth.uid()) then
    raise exception 'only active members can challenge a photo';
  end if;
  if v_checkin.user_id = auth.uid() then
    raise exception 'you cannot challenge your own photo';
  end if;

  select count(*) into v_member_count
    from group_members
    where group_id = v_checkin.group_id and status in ('active', 'needs_recharge') and user_id <> v_checkin.user_id;
  if v_member_count < 1 then
    raise exception 'no eligible members to vote yet';
  end if;

  insert into photo_challenges (
    group_id, checkin_id, target_user_id, challenged_by, reason, required_votes, member_count_snapshot, voting_closes_at
  ) values (
    v_checkin.group_id, p_checkin_id, v_checkin.user_id, auth.uid(), btrim(p_reason),
    floor(v_member_count / 2.0)::int + 1, v_member_count, now() + interval '72 hours'
  ) returning * into v_challenge;

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = v_checkin.group_id and status in ('active', 'needs_recharge')
      and user_id <> auth.uid() and user_id <> v_checkin.user_id;
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva votación de foto', 'Alguien pidió invalidar la foto de un check-in — ve a votar.'
    );
  end if;

  perform send_push_notification(
    array[v_checkin.user_id], 'Tu foto está en votación',
    'Un miembro del grupo pidió invalidar tu check-in. El grupo va a votar si es válido.'
  );

  return v_challenge;
exception
  when unique_violation then
    raise exception 'este check-in ya tiene una votación abierta';
end;
$$;
