-- ============================================================================
-- Relative weight for Cooperativo/Mixto splits. Default 1 = equal footing
-- (today's behavior, unchanged for every existing member). Admin-editable
-- via admin_set_cooperative_share_percent — stored as a weight (not a raw
-- percent) so it never needs manual rebalancing when membership changes:
-- share_i = pool * weight_i / sum(all active weights). A brand-new member
-- simply gets the default weight of 1, diluting everyone proportionally
-- exactly as "an equal new player joined" should.
-- ============================================================================
alter table group_members add column cooperative_weight numeric(10, 4) not null default 1
  check (cooperative_weight > 0);

-- ============================================================================
-- admin_set_cooperative_share_percent: lets the admin express the edit as
-- "this member should be at X%" while storing a weight underneath, solved
-- against everyone else's CURRENT weights — same no-vote direct-admin-tool
-- precedent as admin_set_member_activation_date/admin_set_member_penalty_start_date.
-- ============================================================================
create or replace function admin_set_cooperative_share_percent(p_member_id uuid, p_target_percent numeric)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members%rowtype;
  v_others_weight numeric;
  v_new_weight numeric;
begin
  select * into v_member from group_members where id = p_member_id;
  if not found then
    raise exception 'member not found';
  end if;
  if not is_group_admin(v_member.group_id) then
    raise exception 'only the group admin can adjust cooperative shares';
  end if;
  if p_target_percent <= 0 or p_target_percent >= 100 then
    raise exception 'target percent must be between 0 and 100 (exclusive)';
  end if;

  select coalesce(sum(cooperative_weight), 0) into v_others_weight
    from group_members
    where group_id = v_member.group_id and status in ('active', 'needs_recharge') and id <> p_member_id;
  if v_others_weight <= 0 then
    raise exception 'need at least one other active member to set a relative share';
  end if;

  v_new_weight := v_others_weight * p_target_percent / (100 - p_target_percent);

  update group_members set cooperative_weight = v_new_weight where id = p_member_id
    returning * into v_member;

  perform send_push_notification(
    array[v_member.user_id], 'Tu % en el fondo común cambió',
    format('El administrador ajustó tu participación en el fondo común a %s%%.', p_target_percent),
    p_group_id => v_member.group_id, p_category => 'money'
  );

  return v_member;
end;
$$;

-- ============================================================================
-- pay_out_departing_member: same contract as before, but the Cooperativo/
-- Mixto share is now weight-proportional (cooperative_weight) instead of a
-- strict 1/N — both the departing member's own share AND how the
-- remaining members absorb the delta now scale by weight.
-- ============================================================================
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
  if v_group.payout_mode = 'league' then
    return;
  end if;

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

-- ============================================================================
-- liquidate_group_now: settle the WHOLE group today. Every active member's
-- payout is computed directly from two independent slices of the pool that
-- always sum to the whole pool (no debit/credit dance needed, unlike
-- evaluate_due_league_cycle, because here EVERY member is being zeroed at
-- once, not just the podium):
--   - league_pool = pool * league% (podium places only, ranked as of TODAY)
--   - coop_pool   = pool - league_pool, split by cooperative_weight, PLUS
--     any league prize left unclaimed (splits under 100%, or fewer
--     participants than prize slots) so liquidation never leaves money
--     stranded with no recipient.
--
-- p_dry_run = true: read-only preview, callable by any group member (this
-- is the live "reparto de hoy" everyone sees). p_dry_run = false: actually
-- zeroes every active member's balance — admin only. Same formula either
-- way, so the preview can never drift from what really happens.
-- ============================================================================
create or replace function liquidate_group_now(p_group_id uuid, p_dry_run boolean default false)
returns table(user_id uuid, full_name text, amount numeric, place int, share_percent numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_cycle league_cycles%rowtype;
  v_has_cycle boolean := false;
  v_pool_total numeric(12, 2);
  v_league_pct numeric(5, 2);
  v_league_pool numeric(12, 2);
  v_coop_pool numeric(12, 2);
  v_effective_coop_pool numeric(12, 2);
  v_total_weight numeric;
  v_total_distributed_league numeric(12, 2) := 0;
  v_prize_len int;
  v_rank_group record;
  v_split_idx int;
  v_merged_percent numeric(5, 2);
  v_winner_user_id uuid;
  v_winner_amount numeric(12, 2);
  v_winner_ids uuid[] := '{}';
  v_winner_amounts numeric[] := '{}';
  v_winner_places int[] := '{}';
  v_winner_percents numeric[] := '{}';
  v_member record;
  v_idx int;
  v_this_amount numeric(12, 2);
  v_wtx_id uuid;
begin
  select * into v_group from groups where id = p_group_id;
  if not found then
    raise exception 'group not found';
  end if;
  if not p_dry_run and not is_group_admin(p_group_id) then
    raise exception 'only the group admin can liquidate the group';
  end if;

  if not p_dry_run then
    perform 1 from group_members
      where group_id = p_group_id and status in ('active', 'needs_recharge')
      for update;
  end if;

  select coalesce(sum(balance), 0) into v_pool_total
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

  v_league_pct := case
    when v_group.payout_mode = 'mixed' then v_group.mixed_league_share_percent
    when v_group.payout_mode = 'league' then 100
    else 0
  end;
  v_league_pool := round(v_pool_total * v_league_pct / 100, 2);
  v_coop_pool := v_pool_total - v_league_pool;

  if v_group.payout_mode in ('league', 'mixed') then
    select * into v_cycle from league_cycles where group_id = p_group_id and status = 'running';
    if not found then
      raise exception 'no hay un ciclo de Liga activo para liquidar — inicia uno primero';
    end if;
    v_has_cycle := true;
    v_prize_len := jsonb_array_length(v_cycle.prize_splits);

    for v_rank_group in
      with per_user as (
        select wer.user_id, sum(wer.completed_days) as completed, sum(wer.failed_days) as failed
          from weekly_evaluation_results wer
          join weekly_evaluation_runs wr on wr.id = wer.run_id
          where wer.group_id = p_group_id
            and wr.week_start_date >= v_cycle.started_at::date
            and wr.week_end_date <= current_date
          group by wer.user_id
      ),
      per_user_minutes as (
        select c.user_id, sum(c.workout_minutes) as minutes
          from checkins c
          where c.group_id = p_group_id
            and c.checkin_date >= v_cycle.started_at::date
            and c.checkin_date <= current_date
          group by c.user_id
      ),
      eligible as (
        select gm.user_id from group_members gm
          where gm.group_id = p_group_id and gm.status in ('active', 'needs_recharge')
      ),
      ranked as (
        select
          e.user_id,
          rank() over (
            order by
              coalesce(pu.completed - pu.failed, -999999) desc,
              case when v_group.require_checkout_photo then coalesce(pum.minutes, 0) else 0 end desc
          ) as place
          from eligible e
          left join per_user pu on pu.user_id = e.user_id
          left join per_user_minutes pum on pum.user_id = e.user_id
      )
      select ranked.place as place, array_agg(ranked.user_id order by ranked.user_id) as users, count(*)::int as k
        from ranked
        group by ranked.place
        order by ranked.place
    loop
      exit when v_rank_group.place > v_prize_len;

      v_merged_percent := 0;
      for v_split_idx in v_rank_group.place .. least(v_rank_group.place + v_rank_group.k - 1, v_prize_len) loop
        v_merged_percent := v_merged_percent + (v_cycle.prize_splits ->> (v_split_idx - 1))::numeric;
      end loop;
      v_merged_percent := v_merged_percent / v_rank_group.k;

      foreach v_winner_user_id in array v_rank_group.users loop
        v_winner_amount := round(v_league_pool * v_merged_percent / 100, 2);
        v_winner_ids := v_winner_ids || v_winner_user_id;
        v_winner_amounts := v_winner_amounts || v_winner_amount;
        v_winner_places := v_winner_places || v_rank_group.place;
        v_winner_percents := v_winner_percents || v_merged_percent;
        v_total_distributed_league := v_total_distributed_league + v_winner_amount;
      end loop;
    end loop;
  end if;

  v_effective_coop_pool := v_coop_pool + (v_league_pool - v_total_distributed_league);

  select coalesce(sum(cooperative_weight), 0) into v_total_weight
    from group_members where group_id = p_group_id and status in ('active', 'needs_recharge');

  for v_member in
    select gm.user_id, p.full_name, gm.balance, gm.cooperative_weight
      from group_members gm
      join profiles p on p.id = gm.user_id
      where gm.group_id = p_group_id and gm.status in ('active', 'needs_recharge')
  loop
    v_idx := array_position(v_winner_ids, v_member.user_id);
    v_this_amount := coalesce(v_winner_amounts[v_idx], 0)
      + case when v_total_weight > 0 then round(v_effective_coop_pool * v_member.cooperative_weight / v_total_weight, 2) else 0 end;

    if not p_dry_run then
      insert into wallet_transactions (group_id, user_id, type, amount, status, note, confirmed_at)
        values (
          p_group_id, v_member.user_id, 'payout', -v_member.balance, 'confirmed',
          format('liquidación del grupo: te corresponden %s %s', v_this_amount, v_group.currency), now()
        ) returning id into v_wtx_id;

      if v_idx is not null and v_has_cycle then
        insert into league_cycle_payouts (cycle_id, user_id, place, share_percent, amount, wallet_transaction_id)
          values (v_cycle.id, v_member.user_id, v_winner_places[v_idx], v_winner_percents[v_idx], v_winner_amounts[v_idx], v_wtx_id);
      end if;

      perform send_push_notification(
        array[v_member.user_id], 'Grupo liquidado',
        format('Se liquidó el grupo — te corresponden %s %s.', v_this_amount, v_group.currency),
        p_group_id => p_group_id, p_category => 'money'
      );
    end if;

    user_id := v_member.user_id;
    full_name := v_member.full_name;
    amount := v_this_amount;
    place := v_winner_places[v_idx];
    share_percent := v_winner_percents[v_idx];
    return next;
  end loop;

  if not p_dry_run then
    if v_has_cycle then
      update league_cycles set status = 'completed', completed_at = now(), pool_at_payout = v_league_pool
        where id = v_cycle.id;
    end if;

    if v_group.admin_id is not null then
      perform send_push_notification(
        array[v_group.admin_id], 'Liquidación completada',
        'Se liquidó el grupo — revisa el reparto en Saldo para pagar a cada quien.',
        p_group_id => p_group_id, p_category => 'money'
      );
    end if;
  end if;
end;
$$;
