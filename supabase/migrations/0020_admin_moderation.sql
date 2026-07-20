-- ============================================================================
-- admin_remove_member: kicks a member out of the group. The admin role
-- itself can't be removed this way (there's only ever one admin per group,
-- via groups.admin_id — removing them would orphan every admin-only action).
-- Balance/history are left as-is (a settled ledger, same philosophy as
-- leave_group) — nothing is refunded or erased, the member just can no
-- longer participate.
-- ============================================================================
create or replace function admin_remove_member(p_member_id uuid)
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
    raise exception 'only the group admin can remove members';
  end if;
  if v_member.role = 'admin' then
    raise exception 'the group admin cannot be removed';
  end if;

  update group_members
    set status = 'removed', leave_requested_at = null, leave_effective_at = null
    where id = p_member_id
    returning * into v_member;
  return v_member;
end;
$$;

-- ============================================================================
-- join_group: a member removed by the admin can no longer walk back in with
-- the same invite code (unlike a self-service 'left', which IS allowed to
-- rejoin — see the existing re-activation branch below).
-- ============================================================================
create or replace function join_group(p_invite_code text)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_member group_members%rowtype;
begin
  select id into v_group_id from groups where invite_code = upper(p_invite_code);
  if v_group_id is null then
    raise exception 'invalid invite code';
  end if;

  select * into v_member from group_members
    where group_id = v_group_id and user_id = auth.uid();

  if found then
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
    return v_member;
  end if;

  insert into group_members (group_id, user_id, role, status)
    values (v_group_id, auth.uid(), 'member', 'pending_deposit')
    returning * into v_member;
  return v_member;
end;
$$;

-- ============================================================================
-- admin_delete_checkin: removes a check-in entirely (photo + row), for when
-- the admin determines a photo is wrong/fraudulent — the day stops counting
-- as attended. Unlike the retention sweep (which only ever deletes the
-- storage object, keeping the row as a permanent attendance/audit record),
-- this is a real correction: it takes back credit for the day, so both the
-- object and the row go together.
-- ============================================================================
create or replace function admin_delete_checkin(p_checkin_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkin checkins%rowtype;
begin
  select * into v_checkin from checkins where id = p_checkin_id;
  if not found then
    raise exception 'check-in not found';
  end if;
  if not is_group_admin(v_checkin.group_id) then
    raise exception 'only the group admin can delete check-ins';
  end if;

  delete from storage.objects where bucket_id = 'checkins' and name = v_checkin.photo_path;
  delete from checkins where id = p_checkin_id;
end;
$$;

-- ============================================================================
-- admin_delete_wallet_transaction: lets the admin remove a pending
-- transaction outright (e.g. a duplicate or clearly-bogus receipt) instead
-- of just rejecting it. Deliberately scoped to 'pending' only — a
-- 'confirmed' transaction already moved real balance and is settled ledger
-- history, not something a delete button should be able to unwind.
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
end;
$$;
