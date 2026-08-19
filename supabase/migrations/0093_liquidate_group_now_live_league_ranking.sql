-- ============================================================================
-- liquidate_group_now's league ranking had two real problems, both surfaced
-- by a live example (group "Mis 59", cycle started days ago, no week closed
-- yet): it only ever looked at weekly_evaluation_results — CLOSED weeks —
-- so during the entire first week of every cycle (and any other still-open
-- week) nobody has a completed/failed signal at all, and the rank() fell
-- back entirely to total workout minutes as its only differentiator. Two
-- members with the exact same real attendance (same completed/failed days,
-- same %, same GB Score) ended up split into different places just because
-- one had a few more minutes logged — and, separately, `place` was never
-- even returned for anyone outside the prize table's length, so a display
-- couldn't show "you're 4th" for a non-podium member.
--
-- Fix, per explicit product decision:
--   1. Rank by real attendance for the WHOLE cycle so far, computed the same
--      day-by-day way the rest of the app already does (checkin/valid
--      override beats a failed override beats an excuse beats nothing —
--      mirrors classifyMemberDay in src/lib/domain/attendance.ts), not just
--      closed-week snapshots. This also makes today's ranking match what a
--      member already sees live on Inicio/Dashboard, instead of lagging a
--      week behind.
--   2. Total workout minutes no longer breaks ties at all — a genuine tie in
--      attendance is a genuine tie, full stop.
--   3. `place` is now returned for every ranked member, not just podium
--      winners (rank() already computes it for everyone via the window
--      function; the old code just never captured it past the prize-length
--      early exit). `share_percent`/prize amount merging is unchanged and
--      still only applies within the prize table's length — ties there
--      still split the summed prize percent evenly, exactly as before.
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
  v_place_user_ids uuid[] := '{}';
  v_place_values int[] := '{}';
  v_member record;
  v_idx int;
  v_place_idx int;
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
      -- Every calendar day from the cycle's start (or this member's own
      -- activation, whichever is later) through today, classified exactly
      -- like classifyMemberDay: a real check-in or a valid override (unless
      -- overridden to failed) wins; else an excuse; else it's a failed day.
      -- Today itself is never counted as failed — whoever hasn't checked in
      -- yet still can.
      with member_days as (
        select gm.user_id, d.the_date::date as the_date
          from group_members gm
          cross join lateral generate_series(
            greatest(
              (v_cycle.started_at at time zone v_group.timezone)::date,
              (coalesce(gm.activated_at, gm.joined_at) at time zone v_group.timezone)::date
            )::timestamp,
            v_today::timestamp,
            interval '1 day'
          ) as d(the_date)
          where gm.group_id = p_group_id and gm.status in ('active', 'needs_recharge')
      ),
      classified as (
        select md.user_id, md.the_date,
          case
            when (
              exists (select 1 from checkins c where c.group_id = p_group_id and c.user_id = md.user_id and c.checkin_date = md.the_date)
              or exists (select 1 from attendance_overrides ov where ov.group_id = p_group_id and ov.user_id = md.user_id and ov.override_date = md.the_date and ov.status = 'valid')
            ) and not exists (
              select 1 from attendance_overrides ov2 where ov2.group_id = p_group_id and ov2.user_id = md.user_id and ov2.override_date = md.the_date and ov2.status = 'failed'
            ) then 'completed'
            when exists (select 1 from excuse_dates ed where ed.group_id = p_group_id and ed.user_id = md.user_id and ed.excused_date = md.the_date)
              then 'excused'
            when md.the_date = v_today then 'pending'
            else 'failed'
          end as status
          from member_days md
      ),
      per_user as (
        select classified.user_id,
          count(*) filter (where classified.status = 'completed') as completed,
          count(*) filter (where classified.status = 'failed') as failed
          from classified
          group by classified.user_id
      ),
      eligible as (
        select gm.user_id from group_members gm
          where gm.group_id = p_group_id and gm.status in ('active', 'needs_recharge')
      ),
      ranked as (
        select
          e.user_id,
          rank() over (order by coalesce(pu.completed - pu.failed, -999999) desc) as place
          from eligible e
          left join per_user pu on pu.user_id = e.user_id
      )
      select ranked.place as place, array_agg(ranked.user_id order by ranked.user_id) as users, count(*)::int as k
        from ranked
        group by ranked.place
        order by ranked.place
    loop
      -- Record every member's tie-aware place, prize-eligible or not.
      foreach v_winner_user_id in array v_rank_group.users loop
        v_place_user_ids := v_place_user_ids || v_winner_user_id;
        v_place_values := v_place_values || v_rank_group.place;
      end loop;

      if v_rank_group.place <= v_prize_len then
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
      end if;
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
    v_place_idx := array_position(v_place_user_ids, v_member.user_id);
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
    place := v_place_values[v_place_idx];
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
