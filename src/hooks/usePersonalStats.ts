import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toBogotaDateString, toBogotaHour } from '@/lib/domain/dateUtils';
import { consistencyPercent, tallyAttendance } from '@/lib/domain/attendance';
import {
  currentCompletedStreak,
  longestCompletedStreak,
  longestSingleWorkoutMinutes,
  monthlyConsistency,
  type BadgeCheckinFact,
} from '@/lib/domain/badges';
import {
  averageCheckinHour,
  averageDurationByMonth,
  averageDurationByWeek,
  buildHeatmapWeeks,
  checkinHourBuckets,
  weekdayCompletionRates,
  weeklyConsistency,
  type HourBucket,
  type MonthlyDuration,
  type WeekdayRate,
  type WeeklyDuration,
} from '@/lib/domain/personalStats';
import { useGroupAttendanceRecords } from '@/hooks/useGroupAttendanceRecords';
import { useGroupMonthlyChallenges } from '@/hooks/useGroupMonthlyChallenges';

export interface NamedCount {
  fullName: string;
  count: number;
}

export interface PersonalStats {
  fullName: string;
  currency: string;
  requireCheckoutPhoto: boolean;

  // Trend (1, 2, 3) — both a monthly and a weekly cut, the screen lets the user pick.
  monthlyConsistencySeries: { month: string; percent: number }[];
  monthlyGroupConsistencySeries: { month: string; percent: number }[];
  monthlyDurationSeries: MonthlyDuration[];
  weeklyConsistencySeries: { weekStart: string; percent: number }[];
  weeklyGroupConsistencySeries: { weekStart: string; percent: number }[];
  weeklyDurationSeries: WeeklyDuration[];

  // Streaks (4)
  currentStreak: number;
  longestStreak: number;

  // Patterns (7, 8)
  weekdayRates: WeekdayRate[];
  averageCheckinHour: number | null;
  hourBuckets: HourBucket[];

  // Heatmap (10)
  heatmapWeeks: ReturnType<typeof buildHeatmapWeeks>;

  // Group comparisons (11, 13)
  myConsistencyPercent: number | null;
  groupAverageConsistencyPercent: number | null;
  myAverageWorkoutMinutes: number | null;
  groupAverageWorkoutMinutes: number | null;

  // Historic MVP/top counts, reusing the monthly-challenge tallies (12)
  timesTopDelGrupo: number;
  timesPodio: number;
  timesMvpWeek: number;

  // Personal records (14)
  longestWorkoutMinutes: number | null;
  bestMonth: { month: string; percent: number } | null;

  // Financial, informational only (15)
  myTotalPenalties: number;
  groupAverageTotalPenalties: number;

  // Social (16)
  reactionsGivenTotal: number;
  reactionsReceivedTotal: number;
  mostReactedToByMe: NamedCount | null;
  mostReactedToMe: NamedCount | null;
}

const MONTHS_TO_SHOW = 6;
const WEEKS_TO_SHOW = 12;
const HEATMAP_WEEKS_TO_SHOW = 26;

/**
 * Read-only, purely descriptive personal stats for one member of a group,
 * always alongside the group's own average for context. Never feeds
 * penalties, ranking, or badges — see personalStats.ts.
 */
export function usePersonalStats(groupId: string | null, userId: string | null) {
  const { records, isLoading: recordsLoading, refresh: refreshRecords } = useGroupAttendanceRecords(groupId);
  const { membersChallenges, isLoading: challengesLoading, refresh: refreshChallenges } = useGroupMonthlyChallenges(groupId);

  const [checkinsByUser, setCheckinsByUser] = useState<Map<string, BadgeCheckinFact[]>>(new Map());
  const [penaltiesByUser, setPenaltiesByUser] = useState<Map<string, { weekStartDate: string; penaltyCharged: number }[]>>(
    new Map()
  );
  // Raw (not pre-aggregated) so each member's own activation date can filter
  // out practice/pre-membership reactions before tallying below.
  const [rawReactions, setRawReactions] = useState<{ giverId: string; giverName: string; recipientId: string; date: string }[]>(
    []
  );
  const [groupInfo, setGroupInfo] = useState<{ currency: string; requireCheckoutPhoto: boolean } | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(true);

  const refreshExtras = useCallback(async () => {
    if (!groupId) {
      setCheckinsByUser(new Map());
      setPenaltiesByUser(new Map());
      setRawReactions([]);
      setGroupInfo(null);
      setExtrasLoading(false);
      return;
    }
    setExtrasLoading(true);
    const todayString = toBogotaDateString(new Date());

    const [checkinsRes, resultsRes, reactionsRes, groupRes] = await Promise.all([
      supabase
        .from('checkins')
        .select('user_id, checkin_date, captured_at, workout_minutes')
        .eq('group_id', groupId)
        .lte('checkin_date', todayString),
      supabase
        .from('weekly_evaluation_results')
        .select('user_id, penalty_charged, run:weekly_evaluation_runs(week_start_date)')
        .eq('group_id', groupId),
      supabase
        .from('checkin_reactions')
        .select('user_id, created_at, checkin:checkins(user_id), profile:profiles!user_id(full_name)')
        .eq('group_id', groupId),
      supabase.from('groups').select('currency, require_checkout_photo').eq('id', groupId).single(),
    ]);

    const nextCheckins = new Map<string, BadgeCheckinFact[]>();
    for (const c of (checkinsRes.data ?? []) as {
      user_id: string;
      checkin_date: string;
      captured_at: string;
      workout_minutes: number | null;
    }[]) {
      if (!nextCheckins.has(c.user_id)) nextCheckins.set(c.user_id, []);
      nextCheckins.get(c.user_id)!.push({
        date: c.checkin_date,
        hourBogota: toBogotaHour(new Date(c.captured_at)),
        workoutMinutes: c.workout_minutes,
      });
    }
    setCheckinsByUser(nextCheckins);

    const results = (resultsRes.data ?? []) as unknown as {
      user_id: string;
      penalty_charged: number;
      run: { week_start_date: string } | null;
    }[];
    const nextPenalties = new Map<string, { weekStartDate: string; penaltyCharged: number }[]>();
    for (const r of results) {
      if (!r.run) continue;
      if (!nextPenalties.has(r.user_id)) nextPenalties.set(r.user_id, []);
      nextPenalties.get(r.user_id)!.push({ weekStartDate: r.run.week_start_date, penaltyCharged: r.penalty_charged });
    }
    setPenaltiesByUser(nextPenalties);

    const reactions = (reactionsRes.data ?? []) as unknown as {
      user_id: string;
      created_at: string;
      checkin: { user_id: string } | null;
      profile: { full_name: string } | null;
    }[];
    setRawReactions(
      reactions
        .filter((r) => r.checkin)
        .map((r) => ({
          giverId: r.user_id,
          giverName: r.profile?.full_name ?? 'Miembro',
          recipientId: r.checkin!.user_id,
          date: toBogotaDateString(new Date(r.created_at)),
        }))
    );

    setGroupInfo(
      groupRes.data ? { currency: groupRes.data.currency, requireCheckoutPhoto: groupRes.data.require_checkout_photo } : null
    );

    setExtrasLoading(false);
  }, [groupId]);

  useEffect(() => {
    refreshExtras();
  }, [refreshExtras]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshRecords(), refreshChallenges(), refreshExtras()]);
  }, [refreshRecords, refreshChallenges, refreshExtras]);

  const stats = useMemo<PersonalStats | null>(() => {
    if (!userId || !groupInfo) return null;
    const me = records.find((m) => m.userId === userId);
    if (!me) return null;

    const todayString = toBogotaDateString(new Date());
    const others = records.filter((m) => m.userId !== userId);
    // A check-in/reaction/penalty from before a member's own activation date
    // isn't theirs to count — m.days already applies this rule; the extras
    // fetched independently above (checkins, reactions, penalties) need it
    // applied here too.
    const isOwnedByMember = (m: (typeof records)[number], date: string) => !m.activatedDate || date >= m.activatedDate;
    const myCheckins = (checkinsByUser.get(userId) ?? []).filter((c) => isOwnedByMember(me, c.date));

    // --- 1, 3: monthly consistency, mine and the group's ---
    // The trend chart includes the current, still-forming month/week as its
    // most recent point (a partial period is still informative for a line
    // chart, and excluding it left brand-new groups/members with nothing to
    // show at all) — but "best month" (14) below stays closed-months-only,
    // since a 2-day-old month hitting 100% shouldn't out-rank a real one.
    const myMonthlyForTrend = monthlyConsistency(me.days);
    const myMonthlyClosedOnly = myMonthlyForTrend.filter((m) => m.month < todayString.slice(0, 7));
    const myMonthly = myMonthlyForTrend.slice(-MONTHS_TO_SHOW);
    const monthlyConsistencySeries = myMonthly.map((m) => ({ month: m.month, percent: m.percent }));
    const monthKeys = new Set(monthlyConsistencySeries.map((m) => m.month));
    const groupMonthlyTotals = new Map<string, { completed: number; failed: number }>();
    for (const member of records) {
      for (const m of monthlyConsistency(member.days)) {
        if (!monthKeys.has(m.month)) continue;
        const entry = groupMonthlyTotals.get(m.month) ?? { completed: 0, failed: 0 };
        entry.completed += m.completed;
        entry.failed += m.failed;
        groupMonthlyTotals.set(m.month, entry);
      }
    }
    const monthlyGroupConsistencySeries = monthlyConsistencySeries.map((m) => {
      const totals = groupMonthlyTotals.get(m.month);
      return { month: m.month, percent: totals ? consistencyPercent(totals.completed, totals.failed) ?? 0 : 0 };
    });

    // --- 2: monthly average duration (gated to groups that require checkout photos) ---
    const monthlyDurationSeries = groupInfo.requireCheckoutPhoto ? averageDurationByMonth(myCheckins).slice(-MONTHS_TO_SHOW) : [];

    // --- 1, 2, 3 again, but weekly instead of monthly — also includes the current week ---
    const myWeeklyForTrend = weeklyConsistency(me.days);
    const myWeekly = myWeeklyForTrend.slice(-WEEKS_TO_SHOW);
    const weeklyConsistencySeries = myWeekly.map((w) => ({ weekStart: w.weekStart, percent: w.percent }));
    const weekKeys = new Set(weeklyConsistencySeries.map((w) => w.weekStart));
    const groupWeeklyTotals = new Map<string, { completed: number; failed: number }>();
    for (const member of records) {
      for (const w of weeklyConsistency(member.days)) {
        if (!weekKeys.has(w.weekStart)) continue;
        const entry = groupWeeklyTotals.get(w.weekStart) ?? { completed: 0, failed: 0 };
        entry.completed += w.completed;
        entry.failed += w.failed;
        groupWeeklyTotals.set(w.weekStart, entry);
      }
    }
    const weeklyGroupConsistencySeries = weeklyConsistencySeries.map((w) => {
      const totals = groupWeeklyTotals.get(w.weekStart);
      return { weekStart: w.weekStart, percent: totals ? consistencyPercent(totals.completed, totals.failed) ?? 0 : 0 };
    });
    const weeklyDurationSeries = groupInfo.requireCheckoutPhoto ? averageDurationByWeek(myCheckins).slice(-WEEKS_TO_SHOW) : [];

    // --- 7, 8: weekday and hour patterns ---
    const weekdayRates = weekdayCompletionRates(me.days);
    const hourBuckets = checkinHourBuckets(myCheckins);
    const avgHour = averageCheckinHour(myCheckins);

    // --- 10: heatmap ---
    const heatmapWeeks = buildHeatmapWeeks(me.days, todayString, HEATMAP_WEEKS_TO_SHOW);

    // --- 11, 13: lifetime consistency/duration vs the rest of the group ---
    const myTally = tallyAttendance(me.days.map((d) => d.status));
    const myConsistencyPercent = consistencyPercent(myTally.completedCount, myTally.failedCount);
    const othersTally = tallyAttendance(others.flatMap((m) => m.days.map((d) => d.status)));
    const groupAverageConsistencyPercent =
      others.length > 0 ? consistencyPercent(othersTally.completedCount, othersTally.failedCount) : null;

    const myAverageWorkoutMinutes = groupInfo.requireCheckoutPhoto
      ? (() => {
          const durations = myCheckins.filter((c) => c.workoutMinutes !== null).map((c) => c.workoutMinutes!);
          return durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
        })()
      : null;
    const groupAverageWorkoutMinutes = groupInfo.requireCheckoutPhoto
      ? (() => {
          const durations = others
            .flatMap((m) => (checkinsByUser.get(m.userId) ?? []).filter((c) => isOwnedByMember(m, c.date)))
            .filter((c) => c.workoutMinutes !== null)
            .map((c) => c.workoutMinutes!);
          return durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
        })()
      : null;

    // --- 12: historic MVP/top-of-group tallies, reusing the monthly challenge catalog ---
    const myChallenges = membersChallenges.find((m) => m.userId === userId);
    const timesTopDelGrupo = myChallenges?.statusesById['top-del-grupo']?.timesAchieved ?? 0;
    const timesPodio = myChallenges?.statusesById['podio-del-mes']?.timesAchieved ?? 0;
    const timesMvpWeek = myChallenges?.statusesById['mvp-al-menos-una-vez']?.timesAchieved ?? 0;

    // --- 14: personal records ---
    const longestWorkoutMinutes = groupInfo.requireCheckoutPhoto
      ? (() => {
          const value = longestSingleWorkoutMinutes(myCheckins);
          return value > 0 ? value : null;
        })()
      : null;
    const bestMonth = myMonthlyClosedOnly.reduce<{ month: string; percent: number } | null>(
      (best, m) => (!best || m.percent > best.percent ? { month: m.month, percent: m.percent } : best),
      null
    );

    // --- 15: financial, informational only ---
    const totalPenaltiesFor = (m: (typeof records)[number]) =>
      (penaltiesByUser.get(m.userId) ?? [])
        .filter((p) => isOwnedByMember(m, p.weekStartDate))
        .reduce((sum, p) => sum + p.penaltyCharged, 0);
    const myTotalPenalties = totalPenaltiesFor(me);
    const groupAverageTotalPenalties =
      others.length > 0 ? others.reduce((sum, m) => sum + totalPenaltiesFor(m), 0) / others.length : 0;

    // --- 16: social ---
    const myGivenReactions = rawReactions.filter((r) => r.giverId === userId && isOwnedByMember(me, r.date));
    const myReceivedReactions = rawReactions.filter((r) => r.recipientId === userId && isOwnedByMember(me, r.date));
    let mostReactedToByMe: NamedCount | null = null;
    const givenByRecipient = new Map<string, number>();
    for (const r of myGivenReactions) givenByRecipient.set(r.recipientId, (givenByRecipient.get(r.recipientId) ?? 0) + 1);
    for (const [recipientId, count] of givenByRecipient) {
      if (!mostReactedToByMe || count > mostReactedToByMe.count) {
        mostReactedToByMe = { fullName: records.find((m) => m.userId === recipientId)?.fullName ?? 'Miembro', count };
      }
    }
    let mostReactedToMe: NamedCount | null = null;
    const receivedByGiver = new Map<string, number>();
    for (const r of myReceivedReactions) receivedByGiver.set(r.giverName, (receivedByGiver.get(r.giverName) ?? 0) + 1);
    for (const [fullName, count] of receivedByGiver) {
      if (!mostReactedToMe || count > mostReactedToMe.count) mostReactedToMe = { fullName, count };
    }

    return {
      fullName: me.fullName,
      currency: groupInfo.currency,
      requireCheckoutPhoto: groupInfo.requireCheckoutPhoto,
      monthlyConsistencySeries,
      monthlyGroupConsistencySeries,
      monthlyDurationSeries,
      weeklyConsistencySeries,
      weeklyGroupConsistencySeries,
      weeklyDurationSeries,
      currentStreak: currentCompletedStreak(me.days),
      longestStreak: longestCompletedStreak(me.days),
      weekdayRates,
      averageCheckinHour: avgHour,
      hourBuckets,
      heatmapWeeks,
      myConsistencyPercent,
      groupAverageConsistencyPercent,
      myAverageWorkoutMinutes,
      groupAverageWorkoutMinutes,
      timesTopDelGrupo,
      timesPodio,
      timesMvpWeek,
      longestWorkoutMinutes,
      bestMonth,
      myTotalPenalties,
      groupAverageTotalPenalties,
      reactionsGivenTotal: myGivenReactions.length,
      reactionsReceivedTotal: myReceivedReactions.length,
      mostReactedToByMe,
      mostReactedToMe,
    };
  }, [records, membersChallenges, checkinsByUser, penaltiesByUser, rawReactions, groupInfo, userId]);

  return { stats, isLoading: recordsLoading || challengesLoading || extrasLoading, refresh };
}
