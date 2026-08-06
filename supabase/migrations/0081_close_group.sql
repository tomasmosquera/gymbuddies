-- ============================================================================
-- close_group: lets the admin permanently shut down a group. Today the only
-- way a group's row (and everything scoped to it) ever goes away is via
-- delete_own_account's "admin with no other members left" branch — there was
-- no way for an admin to close a group that still has other active members
-- without offloading them one by one first. This is the missing direct path:
-- settle every active member's balance, notify everyone, wipe their photos
-- from storage, then delete the group outright (cascades remove every
-- group-scoped row — checkins, wallet_transactions, excuse_requests, etc.,
-- all declared `on delete cascade` against groups(id) since 0002-0006).
--
-- Liquidation reuses liquidate_group_now(p_dry_run := false) as-is — same
-- podium/coop-weight formula members already see in "Reparto de hoy"
-- (Saldo tab). That function raises when payout_mode is league/mixed and no
-- league_cycles row is 'running' (by design — it's telling a normal admin
-- "start a cycle before liquidating"). For a group closure that guidance
-- doesn't apply (there's no future cycle to start), so that specific error
-- is caught and falls back to a flat refund of each member's own balance —
-- no podium, just give people their money back. Any other error propagates
-- (a real bug shouldn't be silently swallowed into a wrong payout).
-- ============================================================================
create or replace function close_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_member_ids uuid[];
  v_member record;
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;
  if not is_group_admin(p_group_id) then
    raise exception 'solo el administrador puede cerrar el grupo';
  end if;

  select array_agg(user_id) into v_member_ids
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

  if v_member_ids is not null and array_length(v_member_ids, 1) > 0 then
    begin
      perform liquidate_group_now(p_group_id, false);
    exception
      when others then
        if sqlerrm not ilike '%ciclo de Liga%' then
          raise;
        end if;
        for v_member in
          select user_id, balance from group_members
            where group_id = p_group_id and status in ('active', 'needs_recharge') and balance <> 0
        loop
          insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
            values (
              p_group_id, v_member.user_id, 'payout', -v_member.balance, 'confirmed',
              format('cierre del grupo: se te devuelve tu saldo (%s %s)', v_member.balance, v_group.currency), now()
            );
        end loop;
    end;

    perform send_push_notification(
      v_member_ids, 'Grupo cerrado',
      format('El administrador cerró el grupo "%s". Cualquier saldo pendiente ya fue liquidado — revisa tu saldo.', v_group.name),
      p_group_id => p_group_id, p_category => 'money'
    );
  end if;

  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'checkins' and name like p_group_id::text || '/%';
  delete from storage.objects where bucket_id = 'receipts' and name like p_group_id::text || '/%';
  delete from storage.objects where bucket_id = 'excuse-proofs' and name like p_group_id::text || '/%';

  delete from groups where id = p_group_id;
end;
$$;
