-- Bug fix: submit_workout_checkout's p_auto_created guard refused to fill in
-- a checkout for a checkin that was itself created manually (auto_created =
-- false) — even when called from the cross-group fan-out (client's
-- fanOutCheckoutToOtherGroups). That flag only records which group's screen
-- happened to originate the day's check-in, not which group the person
-- finishes their workout from: the same real session can start in one
-- group and finish from another (e.g. check-in from Group A fans out fine
-- to Group B, but the person happens to tap "confirmar foto final" from
-- Group A later — Group B's own manual checkin, which was the true origin,
-- never got completed, since it was never the one that "created" the
-- fan-out). The guard that actually matters — never overwrite a checkout
-- the person already completed there themselves — is unaffected.
create or replace function submit_workout_checkout(
  p_checkin_id uuid, p_captured_at timestamptz, p_latitude double precision,
  p_longitude double precision, p_location_accuracy_m double precision, p_photo_path text,
  p_location_mocked boolean default false,
  p_auto_created boolean default false
)
returns checkins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
  v_tz text;
  v_is_first_checkout boolean;
  v_group groups%rowtype;
  v_full_name text;
  v_recipient_ids uuid[];
begin
  select * into v_checkin from checkins where id = p_checkin_id and user_id = auth.uid();
  if not found then
    raise exception 'check-in not found';
  end if;
  if p_auto_created and v_checkin.checkout_captured_at is not null then
    return null;
  end if;
  if p_location_mocked then
    raise exception 'mock location detected — disable your fake GPS app to check in';
  end if;

  select timezone into v_tz from groups where id = v_checkin.group_id;
  if v_checkin.checkin_date <> (now() at time zone v_tz)::date then
    raise exception 'checkout can only be submitted the same day as the check-in';
  end if;
  if abs(extract(epoch from (now() - p_captured_at))) > 14400 then
    raise exception 'captured_at is too far from server time (clock drift guard)';
  end if;
  if p_captured_at <= v_checkin.captured_at then
    raise exception 'checkout must be after the initial check-in';
  end if;

  v_is_first_checkout := v_checkin.checkout_captured_at is null;

  update checkins
    set checkout_captured_at = p_captured_at,
        checkout_latitude = p_latitude,
        checkout_longitude = p_longitude,
        checkout_location_accuracy_m = p_location_accuracy_m,
        checkout_photo_path = p_photo_path,
        workout_minutes = greatest(round(extract(epoch from (p_captured_at - v_checkin.captured_at)) / 60)::int, 0)
    where id = p_checkin_id
    returning * into v_checkin;

  if v_is_first_checkout then
    select * into v_group from groups where id = v_checkin.group_id;
    if v_group.require_checkout_photo then
      select full_name into v_full_name from profiles where id = auth.uid();
      select array_agg(user_id) into v_recipient_ids
        from group_members
        where group_id = v_checkin.group_id
          and status in ('pending_deposit', 'active', 'needs_recharge')
          and user_id <> auth.uid();
      if v_recipient_ids is not null then
        perform send_push_notification(
          v_recipient_ids, 'Gym Buddies', format('%s ha terminado su entreno de hoy.', v_full_name),
          p_group_id => v_checkin.group_id, p_category => 'group_activity'
        );
      end if;
    end if;
  end if;

  return v_checkin;
end;
$$;
