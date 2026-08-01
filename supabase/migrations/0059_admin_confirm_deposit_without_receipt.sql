-- ============================================================================
-- Lets the admin confirm a new member's initial deposit directly, without
-- that member having submitted a receipt photo (e.g. paid cash, or sent the
-- transfer via a channel the admin already verified some other way).
-- Mirrors admin_adjust_balance's shape (already-confirmed transaction,
-- apply_wallet_transaction_effect from 0007 handles the balance mutation
-- and pending_deposit -> active flip for any confirmed transaction type),
-- but scoped to a genuine 'initial_deposit' entry so the wallet history and
-- admin-transactions screen still label it correctly.
--
-- If the member had already submitted a receipt photo (a pending
-- 'initial_deposit' transaction), it's rejected here first — otherwise it
-- would linger in the pending-transactions list, and confirming it later
-- would double the balance effect (apply_wallet_transaction_effect applies
-- on every transaction that becomes confirmed, with no de-duplication
-- across rows).
-- ============================================================================
create or replace function admin_confirm_deposit_without_receipt(
  p_group_id uuid, p_user_id uuid, p_amount numeric default null
)
returns wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
  v_amount numeric;
  v_tx wallet_transactions%rowtype;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can confirm a deposit without a receipt';
  end if;

  select * into v_member from group_members where group_id = p_group_id and user_id = p_user_id;
  if not found then
    raise exception 'user is not a member of this group';
  end if;
  if v_member.status <> 'pending_deposit' then
    raise exception 'this member is not waiting on an initial deposit';
  end if;

  v_amount := coalesce(p_amount, (select initial_deposit_amount from groups where id = p_group_id));
  if v_amount <= 0 then
    raise exception 'the deposit amount must be greater than zero';
  end if;

  update wallet_transactions
    set status = 'rejected'
    where group_id = p_group_id and user_id = p_user_id and type = 'initial_deposit' and status = 'pending';

  insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_by, confirmed_at)
    values (
      p_group_id, p_user_id, 'initial_deposit', v_amount, 'confirmed',
      'Confirmado por el admin sin comprobante de foto', auth.uid(), now()
    )
    returning * into v_tx;

  perform send_push_notification(
    array[p_user_id], 'Tu depósito fue confirmado',
    'El administrador confirmó tu depósito inicial — ya puedes participar con normalidad.',
    p_group_id => p_group_id, p_category => 'money'
  );

  return v_tx;
end;
$$;
