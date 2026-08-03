-- ============================================================================
-- liquidate_group_now() (0065) filtered its league-ranking window with plain
-- `current_date` — the Postgres SESSION timezone (UTC on Supabase), not the
-- group's own. Same class of bug fixed everywhere else in 0070, just missed
-- there since 0065 predates that audit.
--
-- Concrete impact: for a group ahead of UTC (e.g. Asia/Shanghai, Europe/
-- Madrid), there's a multi-hour daily window where the group's local "today"
-- has already produced legitimate checkins/weekly results dated with a
-- calendar date UTC hasn't reached yet — `<= current_date` would silently
-- exclude that day's activity from the league podium ranking, right at the
-- moment money actually gets paid out. Groups behind UTC (Bogota, Mexico,
-- Peru, Chile, Argentina, the US) were effectively unaffected — in that
-- direction the filter is only ever more permissive, never restrictive.
-- ============================================================================
create or replace function liquidate_group_now(p_group_id uuid, p_dry_run boolean default false)
returns table(user_id uuid, full_name text, amount numeric, place int, share_percent numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_today date;
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

  v_today := (now() at time zone v_group.timezone)::date;

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
            and wr.week_end_date <= v_today
          group by wer.user_id
      ),
      per_user_minutes as (
        select c.user_id, sum(c.workout_minutes) as minutes
          from checkins c
          where c.group_id = p_group_id
            and c.checkin_date >= v_cycle.started_at::date
            and c.checkin_date <= v_today
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
