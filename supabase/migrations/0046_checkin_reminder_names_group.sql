-- ============================================================================
-- send_checkin_reminders sent one bulk, group-agnostic message to every user
-- missing a check-in *anywhere*. For a member in more than one group (real
-- case: Tomas Mosquera, in both "Gym Buddies" and "GymBuds"), that's
-- ambiguous — they can genuinely have already checked into one group and
-- still correctly get reminded about a different one, but "No olvides
-- hacer tu check-in de hoy" gives no hint which group it's about, reading
-- like a false reminder when it isn't. Looped per group (same pattern
-- run_weekly_evaluation already uses) so the message can name the group.
-- ============================================================================
create or replace function send_checkin_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_group record;
  v_user_ids uuid[];
begin
  for v_group in select id, name from groups loop
    select array_agg(distinct gm.user_id) into v_user_ids
    from group_members gm
    where gm.group_id = v_group.id
      and gm.status in ('pending_deposit', 'active', 'needs_recharge')
      and (coalesce(gm.activated_at, gm.joined_at) at time zone 'America/Bogota')::date <= v_today
      and not exists (
        select 1 from checkins c
        where c.group_id = gm.group_id and c.user_id = gm.user_id and c.checkin_date = v_today
      )
      and not exists (
        select 1 from excuse_dates ed
        where ed.group_id = gm.group_id and ed.user_id = gm.user_id and ed.excused_date = v_today
      );

    if v_user_ids is not null then
      perform send_push_notification(
        v_user_ids, 'Gym Buddies',
        format('No olvides hacer tu check-in de hoy en "%s" 💪', v_group.name),
        p_category => 'reminders'
      );
    end if;
  end loop;
end;
$$;
