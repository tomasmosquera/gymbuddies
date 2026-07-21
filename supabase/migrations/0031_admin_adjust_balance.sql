-- ============================================================================
-- admin_adjust_balance: lets the admin add or remove an arbitrary amount
-- from a member's balance directly (e.g. a cash payment made outside the
-- app, or correcting a mistake) — inserted as an already-'confirmed'
-- 'adjustment' transaction, same shape as the exit-fee charge in
-- leave_group() and the penalty charge in run_weekly_evaluation(). No new
-- balance-mutation path: apply_wallet_transaction_effect() (0007/0012)
-- already applies the effect for any confirmed transaction, whatever its type.
-- ============================================================================
create or replace function admin_adjust_balance(
  p_group_id uuid, p_user_id uuid, p_amount numeric, p_note text default null
)
returns wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx wallet_transactions%rowtype;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can adjust a member''s balance';
  end if;
  if p_amount = 0 then
    raise exception 'the adjustment amount cannot be zero';
  end if;
  if not exists (select 1 from group_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'user is not a member of this group';
  end if;

  insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_by, confirmed_at)
    values (p_group_id, p_user_id, 'adjustment', p_amount, 'confirmed', p_note, auth.uid(), now())
    returning * into v_tx;

  perform send_push_notification(
    array[p_user_id], 'Tu saldo fue ajustado',
    format(
      'El administrador %s tu saldo en %s %s.',
      case when p_amount > 0 then 'aumentó' else 'disminuyó' end,
      (select currency from groups where id = p_group_id),
      to_char(abs(p_amount), 'FM999,999,999')
    )
  );

  return v_tx;
end;
$$;
