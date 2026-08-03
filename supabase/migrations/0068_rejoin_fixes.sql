-- ============================================================================
-- join_group: fixes a real gap in the rejoin path for a member whose
-- status is 'left'. Previously the reactivation branch only reset
-- status/joined_at, leaving activated_at (and penalty_start_date) exactly
-- as they were from the member's ORIGINAL membership. Since
-- apply_wallet_transaction_effect only ever sets activated_at when it's
-- still null, that stale date would silently survive the whole rejoin —
-- every calendar day between their old activated_at and today (including
-- the entire time they were away from the group) would then read as an
-- accountable day with zero check-ins, i.e. a wall of "failed" days in
-- everything that walks a member's full day-by-day history: consistency %,
-- badges, the leaderboard, and Personal Stats. The actual weekly money
-- penalty was never affected by this (run_weekly_evaluation always clamps
-- to just the most recently closed week regardless of how old activated_at
-- is) — this was purely a stats/ranking correctness bug.
--
-- Fix: reset both dates to null on reactivation, exactly mirroring a
-- brand-new member — apply_wallet_transaction_effect then re-derives
-- activated_at itself the next time this membership's deposit is
-- confirmed, the same "first ever deposit" path everyone else goes
-- through. penalty_start_date resets alongside it since it's defined to
-- fall back to activated_at whenever null, and leaving a stale absolute
-- date here could otherwise end up earlier than the new activated_at.
-- ============================================================================
create or replace function join_group(p_invite_code text)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_member group_members%rowtype;
  v_member_existed boolean;
  v_full_name text;
begin
  select * into v_group from groups where invite_code = upper(p_invite_code);
  if not found then
    raise exception 'invalid invite code';
  end if;

  select full_name into v_full_name from profiles where id = auth.uid();

  select * into v_member from group_members
    where group_id = v_group.id and user_id = auth.uid();
  v_member_existed := found;

  if v_member_existed then
    if v_member.status in ('active', 'needs_recharge', 'pending_deposit') then
      raise exception 'already a member of this group';
    end if;
    if v_member.status = 'removed' then
      raise exception 'you were removed from this group and cannot rejoin with this code';
    end if;
    update group_members
      set status = 'pending_deposit', joined_at = now(), activated_at = null, penalty_start_date = null
      where id = v_member.id
      returning * into v_member;
  else
    insert into group_members (group_id, user_id, role, status)
      values (v_group.id, auth.uid(), 'member', 'pending_deposit')
      returning * into v_member;
  end if;

  if v_group.admin_id is not null and v_group.admin_id <> auth.uid() then
    perform send_push_notification(
      array[v_group.admin_id], 'Gym Buddies',
      format('%s se unió al grupo "%s" — falta confirmar su depósito.', v_full_name, v_group.name),
      p_group_id => v_group.id, p_category => 'group_activity', p_data => jsonb_build_object('route', 'new_member')
    );
  end if;

  return v_member;
end;
$$;

-- ============================================================================
-- admin_allow_rejoin: lets the admin lift a removal, letting that person use
-- the group's invite code again. Deliberately doesn't reactivate the
-- membership itself here — it just flips status back to 'left', which puts
-- the member through the exact same join_group reactivation path (and its
-- activated_at/penalty_start_date reset above) as anyone who left on their
-- own, rather than duplicating that logic a second time.
-- ============================================================================
create or replace function admin_allow_rejoin(p_member_id uuid)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
begin
  select * into v_member from group_members where id = p_member_id;
  if not found then
    raise exception 'member not found';
  end if;
  if not is_group_admin(v_member.group_id) then
    raise exception 'only the group admin can allow a removed member to rejoin';
  end if;
  if v_member.status <> 'removed' then
    raise exception 'this member was not removed — nothing to undo';
  end if;

  update group_members set status = 'left' where id = p_member_id returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Gym Buddies',
    'El administrador te permitió volver a unirte a este grupo con el código de invitación.',
    p_group_id => v_member.group_id, p_category => 'admin_actions'
  );

  return v_member;
end;
$$;
