// Runs every 15 minutes (see the cron job scheduled/updated in migrations
// 0049/0052) across every group — but a group with nothing new since its
// last check costs almost nothing: achievement_check_state.dirty_at is
// bumped by a trigger on every table that feeds badges/monthly challenges,
// and a group is only actually evaluated when dirty_at > last_checked_at.
// Badges/monthly challenges are still computed live — this function's only
// job is: evaluate the exact same catalogs the app itself uses (imported
// directly, not reimplemented — see deno.json's import map for how the
// `@/lib/domain/*` aliases inside those files resolve here), diff against
// what's already been notified (member_achievement_notifications /
// member_level_notifications), and push exactly once per new achievement.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  classifyMemberDay,
  rankMembersByConsistency,
  type DayAttendanceStatus,
} from '../../../src/lib/domain/attendance.ts';
import { BADGES, type BadgeContext, type BadgeCheckinFact } from '../../../src/lib/domain/badges.ts';
import {
  MONTHLY_CHALLENGES,
  monthHasFixedHoliday,
  completedOnAnyHoliday,
  allWeekendsCompleted,
  anyWeekendCompleted,
  tallyMonth,
  computeWeeklyMvpsByWeek,
  tallyMvpWeeksByMonth,
  determineTopByCount,
  type MonthlyMemberContext,
  type MonthlyDayRecord,
  type ClosedWeekFacts,
  type MemberWeekAttendance,
} from '../../../src/lib/domain/monthlyChallenges.ts';
import { levelProgress, totalXpForEarnedBadges } from '../../../src/lib/domain/xp.ts';
import {
  enumerateDates,
  enumerateMonths,
  getWeekBounds,
  getWeekBoundsForDateString,
  toZonedDateString,
  toZonedHour,
} from '../../../src/lib/domain/dateUtils.ts';

interface DayRecord {
  date: string;
  status: DayAttendanceStatus;
}

interface MemberRaw {
  userId: string;
  fullName: string;
  joinedAt: string;
  activatedDate: string | null;
  days: DayRecord[];
  checkins: BadgeCheckinFact[];
  weeklyPenalties: { weekStartDate: string; penaltyCharged: number }[];
  hasFundedWallet: boolean;
  reactionsGivenDates: string[];
  reactionsGivenByRecipient: Record<string, number>;
  reactionsReceivedCount: number;
  ruleProposalsWonCount: number;
}

function addDaysToDateString(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function processGroup(
  supabase: ReturnType<typeof createClient>,
  group: { id: string; created_at: string; require_checkout_photo: boolean; timezone: string },
  // Baseline mode: record everything currently true as "already notified"
  // WITHOUT sending a single push. Run this exactly once, by hand, before
  // the cron's first real firing — otherwise the very first run would blast
  // every member with a notification for every badge/level they already
  // had before this feature existed, which is precisely what was ruled out.
  baselineOnly: boolean
) {
  const todayString = toZonedDateString(new Date(), group.timezone);
  const currentMonth = todayString.slice(0, 7);

  const [
    membersRes,
    checkinsRes,
    excusedRes,
    overridesRes,
    resultsRes,
    depositsRes,
    reactionsRes,
    proposalsRes,
    notifiedAchievementsRes,
    notifiedLevelsRes,
  ] = await Promise.all([
    supabase
      .from('group_members')
      .select('user_id, activated_at, joined_at, profile:profiles(full_name)')
      .eq('group_id', group.id)
      .in('status', ['active', 'needs_recharge']),
    supabase
      .from('checkins')
      .select('user_id, checkin_date, captured_at, workout_minutes')
      .eq('group_id', group.id)
      .lte('checkin_date', todayString),
    supabase.from('excuse_dates').select('user_id, excused_date').eq('group_id', group.id).lte('excused_date', todayString),
    supabase
      .from('attendance_overrides')
      .select('user_id, override_date, status')
      .eq('group_id', group.id)
      .lte('override_date', todayString),
    supabase
      .from('weekly_evaluation_results')
      .select('user_id, failed_days, penalty_charged, run:weekly_evaluation_runs(week_start_date)')
      .eq('group_id', group.id),
    supabase
      .from('wallet_transactions')
      .select('user_id')
      .eq('group_id', group.id)
      .in('type', ['initial_deposit', 'recharge'])
      .eq('status', 'confirmed'),
    supabase.from('checkin_reactions').select('user_id, created_at, checkin:checkins(user_id)').eq('group_id', group.id),
    supabase.from('rule_proposals').select('proposed_by, status').eq('group_id', group.id).in('status', ['approved', 'applied']),
    supabase.from('member_achievement_notifications').select('user_id, badge_id, period').eq('group_id', group.id),
    supabase.from('member_level_notifications').select('user_id, last_notified_level').eq('group_id', group.id),
  ]);

  const rawMembers = (membersRes.data ?? []) as unknown as {
    user_id: string;
    activated_at: string | null;
    joined_at: string;
    profile: { full_name: string } | null;
  }[];
  if (rawMembers.length === 0) return;

  const groupCreatedDate = toZonedDateString(new Date(group.created_at), group.timezone);

  // A check-in/reaction/penalty from before a member's own activation date
  // isn't theirs to count — they weren't an accountable member of the group
  // yet (e.g. an admin backdated activation to reset practice-period
  // history). The days-array construction below already applies this rule;
  // every other per-user aggregate built here needs it applied too.
  const activatedDateByUserId = new Map<string, string | null>();
  for (const m of rawMembers) {
    const activatedAt = m.activated_at ?? m.joined_at;
    activatedDateByUserId.set(m.user_id, activatedAt ? toZonedDateString(new Date(activatedAt), group.timezone) : null);
  }
  const isOwned = (userId: string, date: string) => {
    const activatedDate = activatedDateByUserId.get(userId);
    return !activatedDate || date >= activatedDate;
  };

  const checkinDatesByUser = new Map<string, Set<string>>();
  const checkinFactsByUser = new Map<string, BadgeCheckinFact[]>();
  const workoutMinutesByUser = new Map<string, { date: string; minutes: number }[]>();
  for (const c of (checkinsRes.data ?? []) as { user_id: string; checkin_date: string; captured_at: string; workout_minutes: number | null }[]) {
    if (!checkinDatesByUser.has(c.user_id)) checkinDatesByUser.set(c.user_id, new Set());
    checkinDatesByUser.get(c.user_id)!.add(c.checkin_date);
    if (!isOwned(c.user_id, c.checkin_date)) continue;
    if (!checkinFactsByUser.has(c.user_id)) checkinFactsByUser.set(c.user_id, []);
    checkinFactsByUser.get(c.user_id)!.push({
      date: c.checkin_date,
      hourBogota: toZonedHour(new Date(c.captured_at), group.timezone),
      workoutMinutes: c.workout_minutes,
    });
    if (c.workout_minutes !== null) {
      if (!workoutMinutesByUser.has(c.user_id)) workoutMinutesByUser.set(c.user_id, []);
      workoutMinutesByUser.get(c.user_id)!.push({ date: c.checkin_date, minutes: c.workout_minutes });
    }
  }

  const validOverridesByUser = new Map<string, Set<string>>();
  const failedOverridesByUser = new Map<string, Set<string>>();
  for (const o of (overridesRes.data ?? []) as { user_id: string; override_date: string; status: string }[]) {
    const target = o.status === 'valid' ? validOverridesByUser : failedOverridesByUser;
    if (!target.has(o.user_id)) target.set(o.user_id, new Set());
    target.get(o.user_id)!.add(o.override_date);
  }

  const excusedDatesByUser = new Map<string, Set<string>>();
  for (const e of (excusedRes.data ?? []) as { user_id: string; excused_date: string }[]) {
    if (!excusedDatesByUser.has(e.user_id)) excusedDatesByUser.set(e.user_id, new Set());
    excusedDatesByUser.get(e.user_id)!.add(e.excused_date);
  }

  const weeklyResults = (resultsRes.data ?? []) as unknown as {
    user_id: string;
    failed_days: number;
    penalty_charged: number;
    run: { week_start_date: string } | null;
  }[];
  const weeklyPenaltiesByUser = new Map<string, { weekStartDate: string; penaltyCharged: number }[]>();
  for (const r of weeklyResults) {
    if (!r.run || !isOwned(r.user_id, r.run.week_start_date)) continue;
    if (!weeklyPenaltiesByUser.has(r.user_id)) weeklyPenaltiesByUser.set(r.user_id, []);
    weeklyPenaltiesByUser.get(r.user_id)!.push({ weekStartDate: r.run.week_start_date, penaltyCharged: r.penalty_charged });
  }

  const fundedWalletUsers = new Set(((depositsRes.data ?? []) as { user_id: string }[]).map((d) => d.user_id));

  const reactionsGivenDatesByUser = new Map<string, string[]>();
  const reactionsGivenByRecipientByUser = new Map<string, Record<string, number>>();
  const reactionsReceivedByUser = new Map<string, number>();
  const reactionsGivenByUserMonth = new Map<string, Map<string, number>>();
  const reactionsReceivedByUserMonth = new Map<string, Map<string, number>>();
  for (const r of (reactionsRes.data ?? []) as unknown as { user_id: string; created_at: string; checkin: { user_id: string } | null }[]) {
    const dateStr = toZonedDateString(new Date(r.created_at), group.timezone);
    const month = dateStr.slice(0, 7);

    // "Given" tallies are the giver's own achievement — gated by the giver's
    // activation. "Received" tallies are the recipient's — gated by theirs.
    // The two dates can differ, so each side is checked independently.
    if (isOwned(r.user_id, dateStr)) {
      if (!reactionsGivenDatesByUser.has(r.user_id)) reactionsGivenDatesByUser.set(r.user_id, []);
      reactionsGivenDatesByUser.get(r.user_id)!.push(dateStr);
      if (!reactionsGivenByUserMonth.has(r.user_id)) reactionsGivenByUserMonth.set(r.user_id, new Map());
      const givenMonthMap = reactionsGivenByUserMonth.get(r.user_id)!;
      givenMonthMap.set(month, (givenMonthMap.get(month) ?? 0) + 1);

      if (r.checkin) {
        if (!reactionsGivenByRecipientByUser.has(r.user_id)) reactionsGivenByRecipientByUser.set(r.user_id, {});
        const byRecipient = reactionsGivenByRecipientByUser.get(r.user_id)!;
        byRecipient[r.checkin.user_id] = (byRecipient[r.checkin.user_id] ?? 0) + 1;
      }
    }

    if (r.checkin && isOwned(r.checkin.user_id, dateStr)) {
      reactionsReceivedByUser.set(r.checkin.user_id, (reactionsReceivedByUser.get(r.checkin.user_id) ?? 0) + 1);
      if (!reactionsReceivedByUserMonth.has(r.checkin.user_id)) reactionsReceivedByUserMonth.set(r.checkin.user_id, new Map());
      const receivedMonthMap = reactionsReceivedByUserMonth.get(r.checkin.user_id)!;
      receivedMonthMap.set(month, (receivedMonthMap.get(month) ?? 0) + 1);
    }
  }

  const ruleProposalsWonByUser = new Map<string, number>();
  for (const p of (proposalsRes.data ?? []) as { proposed_by: string; status: string }[]) {
    ruleProposalsWonByUser.set(p.proposed_by, (ruleProposalsWonByUser.get(p.proposed_by) ?? 0) + 1);
  }

  const alreadyNotified = new Set(
    ((notifiedAchievementsRes.data ?? []) as { user_id: string; badge_id: string; period: string }[]).map(
      (r) => `${r.user_id}|${r.badge_id}|${r.period}`
    )
  );
  const lastNotifiedLevelByUser = new Map(
    ((notifiedLevelsRes.data ?? []) as { user_id: string; last_notified_level: number }[]).map((r) => [
      r.user_id,
      r.last_notified_level,
    ])
  );

  // --- Build each member's day-by-day record, exactly like useGroupAttendanceRecords ---
  const members: MemberRaw[] = rawMembers.map((m) => {
    const activatedAt = m.activated_at ?? m.joined_at;
    const activatedDate = activatedAt ? toZonedDateString(new Date(activatedAt), group.timezone) : null;
    const checkinDates = checkinDatesByUser.get(m.user_id);
    const validDates = validOverridesByUser.get(m.user_id);
    const failedDates = failedOverridesByUser.get(m.user_id);
    const excusedDates = excusedDatesByUser.get(m.user_id);
    const days: DayRecord[] = [];
    for (const date of enumerateDates(groupCreatedDate, todayString)) {
      if (activatedDate && activatedDate > date) continue;
      const status = classifyMemberDay({
        hasCheckin: checkinDates?.has(date) ?? false,
        hasValidOverride: validDates?.has(date) ?? false,
        hasFailedOverride: failedDates?.has(date) ?? false,
        isExcused: excusedDates?.has(date) ?? false,
      });
      if (status === 'failed' && date === todayString) continue;
      days.push({ date, status });
    }
    return {
      userId: m.user_id,
      fullName: m.profile?.full_name ?? 'Miembro',
      joinedAt: m.joined_at,
      activatedDate,
      days,
      checkins: checkinFactsByUser.get(m.user_id) ?? [],
      weeklyPenalties: weeklyPenaltiesByUser.get(m.user_id) ?? [],
      hasFundedWallet: fundedWalletUsers.has(m.user_id),
      reactionsGivenDates: reactionsGivenDatesByUser.get(m.user_id) ?? [],
      reactionsGivenByRecipient: reactionsGivenByRecipientByUser.get(m.user_id) ?? {},
      reactionsReceivedCount: reactionsReceivedByUser.get(m.user_id) ?? 0,
      ruleProposalsWonCount: ruleProposalsWonByUser.get(m.user_id) ?? 0,
    };
  });

  // --- Weekly MVP across the group's full history, exactly like useGroupMonthlyChallenges ---
  const firstWeekStart = getWeekBoundsForDateString(groupCreatedDate).weekStart;
  const lastWeekStart = getWeekBounds(new Date(), group.timezone).weekStart;
  const weekStarts: string[] = [];
  for (let cursor = firstWeekStart; cursor <= lastWeekStart; cursor = addDaysToDateString(cursor, 7)) {
    weekStarts.push(cursor);
  }
  const allWeekAttendance: MemberWeekAttendance[] = weekStarts.flatMap((weekStart) => {
    const weekEnd = addDaysToDateString(weekStart, 6);
    return members
      .map((m) => {
        const weekDays = m.days.filter((d) => d.date >= weekStart && d.date <= weekEnd);
        const completedCount = weekDays.filter((d) => d.status === 'completed').length;
        const failedCount = weekDays.filter((d) => d.status === 'failed').length;
        const totalWorkoutMinutes = (workoutMinutesByUser.get(m.userId) ?? [])
          .filter((r) => r.date >= weekStart && r.date <= weekEnd)
          .reduce((sum, r) => sum + r.minutes, 0);
        return { userId: m.userId, weekStartDate: weekStart, completedCount, failedCount, totalWorkoutMinutes };
      })
      .filter((w) => w.completedCount + w.failedCount > 0);
  });
  const mvpTallyByMonth = tallyMvpWeeksByMonth(computeWeeklyMvpsByWeek(allWeekAttendance, group.require_checkout_photo));

  // --- Per-month, per-member facts + cross-member rank/mostReacted/mostDuration ---
  const months = enumerateMonths(groupCreatedDate.slice(0, 7), currentMonth);
  const closedMonths = months.filter((m) => m < currentMonth);
  let previousMonthRankByUserId = new Map<string, number>();
  const contextsByMonthByUser = new Map<string, Map<string, MonthlyMemberContext>>();

  for (const month of months) {
    const hasHoliday = monthHasFixedHoliday(month, group.timezone);
    const tallies = new Map(members.map((m) => [m.userId, tallyMonth(m.days.filter((d) => d.date.slice(0, 7) === month) as MonthlyDayRecord[])]));
    const durationsInMonthByUserId = new Map(
      members.map((m) => [
        m.userId,
        (workoutMinutesByUser.get(m.userId) ?? []).filter((r) => r.date.slice(0, 7) === month).map((r) => r.minutes),
      ])
    );
    const totalDurationInMonthByUserId = new Map(
      [...durationsInMonthByUserId.entries()].map(([userId, minutes]) => [userId, minutes.reduce((sum, n) => sum + n, 0)])
    );
    const rankable = members
      .filter((m) => {
        const t = tallies.get(m.userId)!;
        return t.completed + t.failed > 0;
      })
      .map((m) => ({
        userId: m.userId,
        completedCount: tallies.get(m.userId)!.completed,
        failedCount: tallies.get(m.userId)!.failed,
        totalWorkoutMinutes: totalDurationInMonthByUserId.get(m.userId) ?? 0,
      }));
    const rankByUserId = rankMembersByConsistency(rankable, group.require_checkout_photo);
    const mostReacted = new Set(
      determineTopByCount(members.map((m) => ({ userId: m.userId, count: reactionsReceivedByUserMonth.get(m.userId)?.get(month) ?? 0 })))
    );
    const mostDuration = new Set(
      determineTopByCount(members.map((m) => ({ userId: m.userId, count: totalDurationInMonthByUserId.get(m.userId) ?? 0 })))
    );
    const mvpTallyThisMonth = mvpTallyByMonth.get(month) ?? new Map<string, number>();

    const byUser = new Map<string, MonthlyMemberContext>();
    for (const m of members) {
      const daysInMonth = m.days.filter((d) => d.date.slice(0, 7) === month) as MonthlyDayRecord[];
      const { completed, failed, percent } = tallies.get(m.userId)!;
      const durations = durationsInMonthByUserId.get(m.userId) ?? [];
      const totalWorkoutMinutesInMonth = totalDurationInMonthByUserId.get(m.userId) ?? 0;
      byUser.set(m.userId, {
        completedCount: completed,
        failedCount: failed,
        consistencyPercent: percent,
        closedWeeksInMonth: (m.weeklyPenalties as ClosedWeekFacts[]).filter((w) => w.weekStartDate.slice(0, 7) === month),
        monthHasFixedHoliday: hasHoliday,
        completedOnHoliday: completedOnAnyHoliday(daysInMonth, group.timezone),
        allWeekendsCompleted: allWeekendsCompleted(daysInMonth),
        anyWeekendCompleted: anyWeekendCompleted(daysInMonth),
        reactionsGivenCount: reactionsGivenByUserMonth.get(m.userId)?.get(month) ?? 0,
        rank: rankByUserId.get(m.userId) ?? null,
        rankedGroupSize: rankable.length,
        previousMonthRank: previousMonthRankByUserId.get(m.userId) ?? null,
        isMostReactedThisMonth: mostReacted.has(m.userId),
        mvpWeeksThisMonth: mvpTallyThisMonth.get(m.userId) ?? 0,
        groupRequiresCheckoutPhoto: group.require_checkout_photo,
        totalWorkoutMinutesInMonth,
        averageWorkoutMinutesInMonth: durations.length > 0 ? totalWorkoutMinutesInMonth / durations.length : 0,
        workoutSessionsWithDurationInMonth: durations.length,
        isMostDurationThisMonth: mostDuration.has(m.userId),
      });
    }
    contextsByMonthByUser.set(month, byUser);
    previousMonthRankByUserId = rankByUserId;
  }

  // --- Evaluate everything per member, diff against what's already notified ---
  const allMemberIds = members.map((mm) => mm.userId);
  for (const m of members) {
    // personal: sent only to the achiever, 2nd person ("Conseguiste..."). broadcast:
    // sent to the rest of the group, naming the achiever, so teammates can cheer
    // each other on — same 'achievements' category/toggle either way.
    const notifications: { title: string; body: string; broadcastTitle: string; broadcastBody: string }[] = [];

    const badgeCtx: BadgeContext = {
      todayString,
      groupCreatedDate,
      joinedDate: toZonedDateString(new Date(m.joinedAt), group.timezone),
      timezone: group.timezone,
      days: m.days,
      checkins: m.checkins,
      weeklyPenalties: m.weeklyPenalties,
      hasFundedWallet: m.hasFundedWallet,
      reactionsGivenDates: m.reactionsGivenDates,
      reactionsGivenByRecipient: m.reactionsGivenByRecipient,
      reactionsReceivedCount: m.reactionsReceivedCount,
      ruleProposalsWonCount: m.ruleProposalsWonCount,
    };

    const earnedLifetimeIds: string[] = [];
    for (const badge of BADGES) {
      const status = badge.evaluate(badgeCtx);
      if (!status.earned) continue;
      earnedLifetimeIds.push(badge.id);
      const key = `${m.userId}|${badge.id}|lifetime`;
      if (!alreadyNotified.has(key)) {
        alreadyNotified.add(key);
        await supabase
          .from('member_achievement_notifications')
          .insert({ group_id: group.id, user_id: m.userId, badge_id: badge.id, period: 'lifetime' });
        notifications.push({
          title: `${badge.emoji} ¡Nuevo logro desbloqueado!`,
          body: `Conseguiste "${badge.name}" — ${badge.description}`,
          broadcastTitle: `${badge.emoji} ¡Nuevo logro en el grupo!`,
          broadcastBody: `${m.fullName} consiguió "${badge.name}" — ${badge.description}`,
        });
      }
    }

    let monthlyXp = 0;
    for (const challenge of MONTHLY_CHALLENGES) {
      let timesAchieved = 0;
      // Monotonic challenges are credited the moment they're met, including
      // the still-open current month — see monthlyChallenges.ts.
      const evalMonths = challenge.monotonic ? months : closedMonths;
      for (const month of evalMonths) {
        const ctx = contextsByMonthByUser.get(month)?.get(m.userId);
        if (!ctx) continue;
        const result = challenge.evaluate(ctx);
        if (result !== true) continue;
        timesAchieved++;
        const key = `${m.userId}|${challenge.id}|${month}`;
        if (!alreadyNotified.has(key)) {
          alreadyNotified.add(key);
          await supabase
            .from('member_achievement_notifications')
            .insert({ group_id: group.id, user_id: m.userId, badge_id: challenge.id, period: month });
          notifications.push({
            title: `${challenge.emoji} ¡Reto del mes cumplido!`,
            body: `Conseguiste "${challenge.name}" — ${challenge.description}`,
            broadcastTitle: `${challenge.emoji} ¡Reto del mes cumplido en el grupo!`,
            broadcastBody: `${m.fullName} cumplió el reto "${challenge.name}" — ${challenge.description}`,
          });
        }
      }
      monthlyXp += timesAchieved * challenge.xpPerOccurrence;
    }

    const totalXp = totalXpForEarnedBadges(earnedLifetimeIds) + monthlyXp;
    const { level } = levelProgress(totalXp);
    const lastNotifiedLevel = lastNotifiedLevelByUser.get(m.userId) ?? 0;
    if (level > lastNotifiedLevel) {
      await supabase
        .from('member_level_notifications')
        .upsert({ group_id: group.id, user_id: m.userId, last_notified_level: level, updated_at: new Date().toISOString() });
      notifications.push({
        title: '🎉 ¡Subiste de nivel!',
        body: `Ahora eres nivel ${level}.`,
        broadcastTitle: '🎉 ¡Alguien subió de nivel!',
        broadcastBody: `${m.fullName} ahora es nivel ${level}.`,
      });
    }

    if (!baselineOnly) {
      const otherMemberIds = allMemberIds.filter((id) => id !== m.userId);
      for (const n of notifications) {
        // data.user_id is always the achiever, whether the recipient is that
        // person (tapping opens "Tus logros") or a teammate (tapping opens
        // the achiever's own logros) — see notificationRouting.ts.
        await supabase.rpc('send_push_notification', {
          p_user_ids: [m.userId],
          p_title: n.title,
          p_body: n.body,
          p_group_id: group.id,
          p_category: 'achievements',
          p_data: { user_id: m.userId },
        });
        if (otherMemberIds.length > 0) {
          await supabase.rpc('send_push_notification', {
            p_user_ids: otherMemberIds,
            p_title: n.broadcastTitle,
            p_body: n.broadcastBody,
            p_group_id: group.id,
            p_category: 'achievements',
            p_data: { user_id: m.userId },
          });
        }
      }
    }
  }
}

Deno.serve(async (req) => {
  let baselineOnly = false;
  try {
    const body = await req.json();
    baselineOnly = body?.baseline === true;
  } catch {
    // No JSON body (e.g. the daily cron's empty '{}' or no body at all) — normal run.
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: groups, error } = await supabase
    .from('groups')
    .select('id, created_at, require_checkout_photo, timezone');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const { data: checkStates } = await supabase
    .from('achievement_check_state')
    .select('group_id, dirty_at, last_checked_at');
  const checkStateByGroup = new Map(
    ((checkStates ?? []) as { group_id: string; dirty_at: string; last_checked_at: string | null }[]).map((s) => [
      s.group_id,
      s,
    ])
  );

  let groupsProcessed = 0;
  for (const group of (groups ?? []) as { id: string; created_at: string; require_checkout_photo: boolean; timezone: string }[]) {
    const state = checkStateByGroup.get(group.id);
    const isDirty = !state || !state.last_checked_at || new Date(state.dirty_at) > new Date(state.last_checked_at);
    if (!baselineOnly && !isDirty) continue;

    const checkStartedAt = new Date().toISOString();
    try {
      await processGroup(supabase, group, baselineOnly);
      await supabase.from('achievement_check_state').upsert({ group_id: group.id, last_checked_at: checkStartedAt });
      groupsProcessed++;
    } catch (err) {
      console.error(`notify-achievements failed for group ${group.id}:`, err);
    }
  }

  return new Response(JSON.stringify({ ok: true, baselineOnly, groupsProcessed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
