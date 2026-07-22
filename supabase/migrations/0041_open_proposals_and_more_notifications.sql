-- ============================================================================
-- Rule proposals were wrongly restricted to the admin only (both the RPC's
-- is_group_admin gate and the client's isAdmin-only "Proponer cambio" button
-- — see app/(app)/rules/propose.tsx, which was already written to handle a
-- non-admin proposer fine: it only special-cases the admin-only "apply
-- directly, skip the vote" mode). Any member should be able to open a
-- proposal for the group to vote on — only bypassing the vote entirely
-- (apply_rule_change_direct) and cancelling a pending vote stay admin-only
-- superpowers. Widened to is_voting_member, same gate used for check-in,
-- excuses, etc. The notification text hardcoded "El administrador" as the
-- proposer, which is no longer always true — now names whoever actually
-- proposed it.
-- ============================================================================
create or replace function propose_rule_change(
  p_group_id uuid,
  p_changes jsonb,
  p_apply_immediately boolean default false
)
returns rule_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count int;
  v_proposal rule_proposals%rowtype;
  v_recipient_ids uuid[];
  v_full_name text;
begin
  if not is_voting_member(p_group_id, auth.uid()) then
    raise exception 'only active members can propose rule changes';
  end if;

  select count(*) into v_member_count
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge');

  if v_member_count < 1 then
    raise exception 'no active members to vote yet';
  end if;

  insert into rule_proposals (
    group_id, proposed_by, proposed_changes, required_votes,
    member_count_snapshot, voting_closes_at, apply_immediately
  ) values (
    p_group_id, auth.uid(), p_changes, floor(v_member_count / 2.0)::int + 1,
    v_member_count, now() + interval '72 hours', p_apply_immediately
  ) returning * into v_proposal;

  select full_name into v_full_name from profiles where id = auth.uid();

  select array_agg(user_id) into v_recipient_ids
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> auth.uid();
  if v_recipient_ids is not null then
    perform send_push_notification(
      v_recipient_ids, 'Nueva propuesta de regla', format('%s propuso un cambio de reglas — ve a votar.', v_full_name)
    );
  end if;

  return v_proposal;
exception
  when unique_violation then
    raise exception 'this group already has an open rule vote';
end;
$$;

-- ============================================================================
-- join_group: the admin had no way to find out someone joined (or rejoined
-- after leaving) until they happened to open the pending-deposits list.
-- Covers both branches — brand new membership and a re-activated 'left' one
-- — with a single notification after whichever branch ran.
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
      set status = 'pending_deposit', joined_at = now()
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
      format('%s se unió al grupo "%s" — falta confirmar su depósito.', v_full_name, v_group.name)
    );
  end if;

  return v_member;
end;
$$;

-- ============================================================================
-- admin_delete_wallet_transaction: the member whose pending receipt just got
-- deleted was never told — from their side it would just silently vanish.
-- ============================================================================
create or replace function admin_delete_wallet_transaction(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx wallet_transactions%rowtype;
begin
  select * into v_tx from wallet_transactions where id = p_transaction_id;
  if not found then
    raise exception 'transaction not found';
  end if;
  if not is_group_admin(v_tx.group_id) then
    raise exception 'only the group admin can delete transactions';
  end if;
  if v_tx.status <> 'pending' then
    raise exception 'only pending transactions can be deleted';
  end if;

  if v_tx.receipt_path is not null then
    delete from storage.objects where bucket_id = 'receipts' and name = v_tx.receipt_path;
  end if;
  delete from wallet_transactions where id = p_transaction_id;

  perform send_push_notification(
    array[v_tx.user_id], 'Tu comprobante fue eliminado',
    'El administrador eliminó tu comprobante pendiente. Si fue un error, puedes volver a enviarlo.'
  );
end;
$$;
