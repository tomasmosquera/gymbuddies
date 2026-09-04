-- ============================================================================
-- League mode's departing-member gap: pay_out_departing_member has always
-- no-op'd for payout_mode = 'league' (see its own early `if payout_mode =
-- 'league' then return`), which meant a departing member's balance was
-- never refunded to them AND never counted toward the league prize pool
-- again (evaluate_due_league_cycle/liquidate_group_now only sum balance for
-- status in ('active','needs_recharge') — once a member's row flips to
-- 'left'/'removed', that balance is silently orphaned). Confirmed and
-- manually corrected for one real member (Elena) before writing this
-- migration.
--
-- Fix: the group ADMIN decides, per departure, whether that balance gets
-- refunded to the departing member or forfeited into the pool (redistributed
-- equally across the members who remain active, since group_members.balance
-- is exactly what feeds the league pool calculation — no changes needed
-- there). Two different moments call for two different mechanisms:
--   - Admin-initiated removal (admin_remove_member): the admin is already
--     present, decides synchronously, same p_pay_out param it already has.
--   - Member-initiated departure (leave_group, immediate or, via
--     process_scheduled_leaves, with notice): the admin isn't present at
--     that moment, so the balance is left untouched (pending) and the admin
--     is notified to resolve it later from a new "pending settlements"
--     section in Miembros.
--
-- Collateral fix: admin_remove_member has had two simultaneous live
-- overloads since 0063 (the 1-arg version from 0061 was never dropped) —
-- the same overload-ambiguity bug class already fixed elsewhere this
-- session. Dropped here since this function is being rewritten anyway.
-- ============================================================================

drop function if exists admin_remove_member(uuid);

-- ----------------------------------------------------------------------------
-- admin_settle_league_departure: the actual money-moving logic for a league
-- departure, callable both directly (new "pending settlements" UI) and from
-- admin_remove_member (real-time choice at removal time). Admin-gated on its
-- own — never assume the caller already checked.
-- ----------------------------------------------------------------------------
create or replace function admin_settle_league_departure(p_group_id uuid, p_user_id uuid, p_refund boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_departing group_members%rowtype;
  v_remaining_user_ids uuid[];
  v_active_count int;
  v_delta_cents bigint;
  v_base_cents bigint;
  v_remainder_cents int;
  v_sign int;
  v_i int;
begin
  if not is_group_admin(p_group_id) then
    raise exception 'only the group admin can settle a departing member''s balance';
  end if;

  select * into v_group from groups where id = p_group_id;

  select * into v_departing from group_members where group_id = p_group_id and user_id = p_user_id;
  if not found or v_departing.balance = 0 then
    return;
  end if;

  if p_refund then
    insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
      values (
        p_group_id, p_user_id, 'payout', -v_departing.balance, 'confirmed',
        format('salida de liga: se devuelve tu saldo completo (%s %s)', v_departing.balance, v_group.currency), now()
      );

    perform send_push_notification(
      array[p_user_id], 'Saldo liquidado',
      format('Tu salida de %s incluye la devolución de tu saldo completo: %s %s.', v_group.name, v_departing.balance, v_group.currency),
      p_group_id => p_group_id, p_category => 'money'
    );
  else
    insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
      values (
        p_group_id, p_user_id, 'penalty', -v_departing.balance, 'confirmed',
        format('salida de liga: tu saldo de %s %s queda en el pozo de premios', v_departing.balance, v_group.currency), now()
      );

    -- Equal split across whoever remains active — league has never used
    -- cooperative_weight for anything, so there's no notion of "weight" to
    -- apply here the way pay_out_departing_member does for cooperative.
    select array_agg(user_id order by joined_at asc) into v_remaining_user_ids
      from group_members
      where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> p_user_id;

    if v_remaining_user_ids is not null then
      v_active_count := array_length(v_remaining_user_ids, 1);
      v_delta_cents := round(v_departing.balance * 100);
      v_base_cents := trunc(v_delta_cents::numeric / v_active_count);
      v_remainder_cents := (v_delta_cents - v_base_cents * v_active_count)::int;
      v_sign := sign(v_remainder_cents)::int;

      for v_i in 1 .. v_active_count loop
        insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
          values (
            p_group_id, v_remaining_user_ids[v_i], 'payout',
            (v_base_cents + case when v_i <= abs(v_remainder_cents) then v_sign else 0 end) / 100.0,
            'confirmed', 'aporte al pozo de liga por salida de un miembro', now()
          );
      end loop;
    end if;
    -- If nobody remains active, the forfeited amount simply isn't
    -- redistributed to anyone — same accepted edge case as descenso when
    -- there's nothing left to distribute into.

    perform send_push_notification(
      array[p_user_id], 'Saldo aportado al pozo',
      format('Tu salida de %s no incluyó devolución — tu saldo de %s %s quedó en el fondo del grupo.', v_group.name, v_departing.balance, v_group.currency),
      p_group_id => p_group_id, p_category => 'money'
    );
  end if;

  if v_group.admin_id is not null and v_group.admin_id <> p_user_id then
    perform send_push_notification(
      array[v_group.admin_id], 'Salida liquidada',
      format('Se resolvió el saldo de un miembro que salió de %s.', v_group.name),
      p_group_id => p_group_id, p_category => 'money'
    );
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- pay_out_departing_member: the league branch stops being a silent no-op —
-- still doesn't touch the balance (that's now the admin's call, made later
-- via admin_settle_league_departure), but tells the admin there's a
-- decision pending. Call sites (leave_group, process_scheduled_leaves) are
-- unchanged — this function's signature stays the same.
-- ----------------------------------------------------------------------------
create or replace function pay_out_departing_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_departing group_members%rowtype;
  v_pool_before numeric(12, 2);
  v_coop_pool numeric(12, 2);
  v_total_weight numeric;
  v_remaining_weight_total numeric;
  v_share numeric(12, 2);
  v_delta_total numeric(12, 2);
  v_delta_cents bigint;
  v_remaining_user_ids uuid[];
  v_remaining_weights numeric[];
  v_remaining_base_cents bigint[];
  v_assigned_cents bigint;
  v_remainder_cents int;
  v_sign int;
  v_n int;
  v_i int;
begin
  select * into v_group from groups where id = p_group_id;

  -- League: no locking needed (nothing gets computed/redistributed here —
  -- that only happens later, in admin_settle_league_departure, once the
  -- admin decides). This read is deliberately outside any lock; it only
  -- feeds a notification message, not a financial calculation.
  if v_group.payout_mode = 'league' then
    select * into v_departing
      from group_members
      where group_id = p_group_id and user_id = p_user_id and status in ('active', 'needs_recharge');
    if found and v_departing.balance <> 0 and v_group.admin_id is not null then
      perform send_push_notification(
        array[v_group.admin_id], 'Decide el saldo de quien salió',
        format(
          '%s salió de %s con %s %s en su saldo — decide si se le devuelve o queda en el pozo de premios, desde Miembros.',
          coalesce((select full_name from profiles where id = p_user_id), 'Un miembro'),
          v_group.name, v_departing.balance, v_group.currency
        ),
        p_group_id => p_group_id, p_category => 'money', p_data => jsonb_build_object('route', 'league_departure')
      );
    end if;
    return;
  end if;

  -- Cooperative/mixed: unchanged from the live version — lock every active
  -- member's row first, then read the departing member's balance from
  -- within that same locked snapshot, so a concurrent change never gets
  -- used stale by the redistribution math below.
  perform 1 from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge')
    for update;

  select * into v_departing
    from group_members
    where group_id = p_group_id and user_id = p_user_id and status in ('active', 'needs_recharge');
  if not found then
    return;
  end if;

  select coalesce(sum(balance), 0), coalesce(sum(cooperative_weight), 0) into v_pool_before, v_total_weight
    from group_members
    where group_id = p_group_id and status in ('active', 'needs_recharge');

  v_coop_pool := case
    when v_group.payout_mode = 'mixed' then v_pool_before * (1 - v_group.mixed_league_share_percent / 100)
    else v_pool_before
  end;
  v_share := greatest(round(v_coop_pool * v_departing.cooperative_weight / v_total_weight, 2), 0);
  v_remaining_weight_total := v_total_weight - v_departing.cooperative_weight;

  insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
    values (
      p_group_id, p_user_id, 'payout', -v_departing.balance, 'confirmed',
      format('salida del grupo: se liquida tu saldo, te corresponden %s %s del fondo', v_share, v_group.currency),
      now()
    );

  if v_remaining_weight_total > 0 then
    select array_agg(user_id order by joined_at asc), array_agg(cooperative_weight order by joined_at asc)
      into v_remaining_user_ids, v_remaining_weights
      from group_members
      where group_id = p_group_id and status in ('active', 'needs_recharge') and user_id <> p_user_id;

    v_n := array_length(v_remaining_user_ids, 1);
    v_delta_total := v_departing.balance - v_share;
    v_delta_cents := round(v_delta_total * 100);

    v_remaining_base_cents := array_fill(0::bigint, array[v_n]);
    v_assigned_cents := 0;
    for v_i in 1 .. v_n loop
      v_remaining_base_cents[v_i] := trunc(v_delta_cents::numeric * v_remaining_weights[v_i] / v_remaining_weight_total);
      v_assigned_cents := v_assigned_cents + v_remaining_base_cents[v_i];
    end loop;
    v_remainder_cents := (v_delta_cents - v_assigned_cents)::int;
    v_sign := sign(v_remainder_cents)::int;

    for v_i in 1 .. v_n loop
      insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
        values (
          p_group_id, v_remaining_user_ids[v_i], 'payout',
          (v_remaining_base_cents[v_i] + case when v_i <= abs(v_remainder_cents) then v_sign else 0 end) / 100.0,
          'confirmed', 'ajuste de fondo común por salida de un miembro', now()
        );
    end loop;
  end if;

  perform send_push_notification(
    array[p_user_id], 'Saldo liquidado',
    format('Tu salida del fondo común te corresponde %s %s.', v_share, v_group.currency),
    p_group_id => p_group_id, p_category => 'money'
  );

  if v_group.admin_id is not null and v_group.admin_id <> p_user_id then
    perform send_push_notification(
      array[v_group.admin_id], 'Pago de salida registrado',
      format('Se liquidó el saldo de un miembro que salió del grupo — le corresponden %s %s del fondo común.', v_share, v_group.currency),
      p_group_id => p_group_id, p_category => 'money'
    );
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- admin_remove_member: same public signature as today — the payout decision
-- branch now covers league too, routed through admin_settle_league_departure
-- instead of pay_out_departing_member (which, for league, would only defer
-- and notify — pointless when the admin's choice is already known here).
-- ----------------------------------------------------------------------------
create or replace function admin_remove_member(p_member_id uuid, p_pay_out boolean default true)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
  v_group groups%rowtype;
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

  select * into v_group from groups where id = v_member.group_id;

  if v_member.status in ('active', 'needs_recharge') then
    if v_group.payout_mode in ('cooperative', 'mixed') then
      if p_pay_out then
        perform pay_out_departing_member(v_member.group_id, v_member.user_id);
      end if;
    elsif v_group.payout_mode = 'league' then
      perform admin_settle_league_departure(v_member.group_id, v_member.user_id, p_pay_out);
    end if;
  end if;

  update group_members
    set status = 'removed', leave_requested_at = null, leave_effective_at = null
    where id = p_member_id
    returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Fuiste removido del grupo', 'El administrador te sacó del grupo.',
    p_group_id => v_member.group_id, p_category => 'admin_actions', p_data => jsonb_build_object('route', 'removed')
  );

  return v_member;
end;
$$;
