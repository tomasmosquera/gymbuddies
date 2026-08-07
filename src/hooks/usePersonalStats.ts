import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString, toZonedHour } from '@/lib/domain/dateUtils';
import { consistencyPercent, tallyAttendance } from '@/lib/domain/attendance';
import {
  currentCompletedStreak,
  longestCompletedStreak,
  longestSingleWorkoutMinutes,
  monthlyConsistency,
  type BadgeCheckinFact,
} from '@/lib/domain/badges';
import {
  addDaysToDateString,
  averageCheckinHour,
  averageDurationByDay,
  averageDurationByMonth,
  averageDurationByWeek,
  buildHeatmapWeeks,
  checkinHourBuckets,
  dailyConsistency,
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

export interface EmojiCount {
  emoji: string;
  count: number;
}

export interface PersonalStats {
  fullName: string;
  currency: string;
  requireCheckoutPhoto: boolean;

  // Trend (1, 2, 3) — a monthly, weekly, and daily (trailing DAYS_TO_SHOW days) cut, the screen lets the user pick.
  monthlyConsistencySeries: { month: string; percent: number }[];
  monthlyGroupConsistencySeries: { month: string; percent: number }[];
  monthlyDurationSeries: MonthlyDuration[];
  monthlyGroupDurationSeries: { month: string; avgMinutes: number | null }[];
  weeklyConsistencySeries: { weekStart: string; percent: number }[];
  weeklyGroupConsistencySeries: { weekStart: string; percent: number }[];
  weeklyDurationSeries: WeeklyDuration[];
  weeklyGroupDurationSeries: { weekStart: string; avgMinutes: number | null }[];
  dailyConsistencySeries: { date: string; percent: number | null }[];
  dailyGroupConsistencySeries: { date: string; percent: number | null }[];
  dailyDurationSeries: { date: string; avgMinutes: number | null }[];
  dailyGroupDurationSeries: { date: string; avgMinutes: number | null }[];

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
  mostSentEmoji: EmojiCount | null;
  mostReceivedEmoji: EmojiCount | null;
}

const MONTHS_TO_SHOW = 12;
const WEEKS_TO_SHOW = 24;
const DAYS_TO_SHOW = 60;
const HEATMAP_WEEKS_TO_SHOW = 26;

/**
 * Read-only, purely descriptive personal stats for one member of a group,
 * always alongside the group's own average for context. Never feeds
 * penalties, ranking, or badges — see personalStats.ts.
 */
export function usePersonalStats(groupId: string | null, userId: string | null, timezone: string) {
  const { records, isLoading: recordsLoading, refresh: refreshRecords } = useGroupAttendanceRecords(groupId, timezone);
  const { membersChallenges, isLoading: challengesLoading, refresh: refreshChallenges } = useGroupMonthlyChallenges(
    groupId,
    timezone
  );

  const [checkinsByUser, setCheckinsByUser] = useState<Map<string, BadgeCheckinFact[]>>(new Map());
  const [penaltiesByUser, setPenaltiesByUser] = useState<Map<string, { weekStartDate: string; penaltyCharged: number }[]>>(
    new Map()
  );
  // Raw (not pre-aggregated) so each member's own activation date can filter
  // out practice/pre-membership reactions before tallying below.
  const [rawReactions, setRawReactions] = useState<
    { giverId: string; giverName: string; recipientId: string; date: string; emoji: string }[]
  >([]);
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
    const todayString = toZonedDateString(new Date(), timezone);

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
        .select('user_id, emoji, created_at, checkin:checkins(user_id), profile:profiles!user_id(full_name)')
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
        hourBogota: toZonedHour(new Date(c.captured_at), timezone),
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
      emoji: string;
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
          date: toZonedDateString(new Date(r.created_at), timezone),
          emoji: r.emoji,
        }))
    );

    setGroupInfo(
      groupRes.data ? { currency: groupRes.data.currency, requireCheckoutPhoto: groupRes.data.require_checkout_photo } : null
    );

    setExtrasLoading(false);
  }, [groupId, timezone]);

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

    const todayString = toZonedDateString(new Date(), timezone);
    const others = records.filter((m) => m.userId !== userId);
    // A check-in/reaction/penalty from before a member's own activation date
    // isn't theirs to count — m.days already applies this rule; the extras
    // fetched independently above (checkins, reactions, penalties) need it
    // applied here too.
    const isOwnedByMember = (m: (typeof records)[number], date: string) => !m.activatedDate || date >= m.activatedDate;
    const myCheckins = (checkinsByUser.get(userId) ?? []).filter((c) => isOwnedByMember(me, c.date));
    // Every member's checkins pooled together — averageDurationByWeek/Month/Day
    // don't care whose checkins they're given, so reusing them on this pool
    // is what turns a "mine" duration series into a "group" one for free.
    const allCheckins = records.flatMap((m) => (checkinsByUser.get(m.userId) ?? []).filter((c) => isOwnedByMember(m, c.date)));

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
    const monthlyGroupDurationByKey = new Map(
      groupInfo.requireCheckoutPhoto ? averageDurationByMonth(allCheckins).map((m) => [m.month, m.avgMinutes]) : []
    );
    const monthlyGroupDurationSeries = monthlyDurationSeries.map((m) => ({
      month: m.month,
      avgMinutes: monthlyGroupDurationByKey.get(m.month) ?? null,
    }));

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
    const weeklyGroupDurationByKey = new Map(
      groupInfo.requireCheckoutPhoto ? averageDurationByWeek(allCheckins).map((w) => [w.weekStart, w.avgMinutes]) : []
    );
    const weeklyGroupDurationSeries = weeklyDurationSeries.map((w) => ({
      weekStart: w.weekStart,
      avgMinutes: weeklyGroupDurationByKey.get(w.weekStart) ?? null,
    }));

    // --- 1, 2, 3 again, but daily instead of weekly/monthly. Clipped to
    // my own activation date the same way weeklyConsistency/monthlyConsistency
    // naturally are (their source, me.days, simply doesn't go back further) —
    // a member who joined 10 days ago shouldn't see 50 empty days before that. ---
    const dailyNaiveStart = addDaysToDateString(todayString, -(DAYS_TO_SHOW - 1));
    const dailyWindowStart = me.days[0] && me.days[0].date > dailyNaiveStart ? me.days[0].date : dailyNaiveStart;
    const myDailyConsistency = dailyConsistency(me.days, dailyWindowStart, todayString);
    const dailyConsistencySeries = myDailyConsistency.map((d) => ({ date: d.date, percent: d.percent }));
    const groupDailyTotals = new Map<string, { completed: number; failed: number }>();
    for (const member of records) {
      for (const d of dailyConsistency(member.days, dailyWindowStart, todayString)) {
        const entry = groupDailyTotals.get(d.date) ?? { completed: 0, failed: 0 };
        entry.completed += d.completed;
        entry.failed += d.failed;
        groupDailyTotals.set(d.date, entry);
      }
    }
    // Unlike the weekly/monthly group series (which default a data-less
    // period to 0%), a bare calendar day with nobody's data at all means
    // "nothing happened yet", not "the group failed" — so it stays a gap.
    const dailyGroupConsistencySeries = dailyConsistencySeries.map((d) => {
      const totals = groupDailyTotals.get(d.date);
      const total = (totals?.completed ?? 0) + (totals?.failed ?? 0);
      return { date: d.date, percent: total > 0 ? consistencyPercent(totals!.completed, totals!.failed) : null };
    });

    const myDailyDuration = groupInfo.requireCheckoutPhoto ? averageDurationByDay(myCheckins, dailyWindowStart, todayString) : [];
    const dailyDurationSeries = myDailyDuration.map((d) => ({ date: d.date, avgMinutes: d.avgMinutes }));
    const dailyGroupDurationByKey = new Map(
      groupInfo.requireCheckoutPhoto ? averageDurationByDay(allCheckins, dailyWindowStart, todayString).map((d) => [d.date, d.avgMinutes]) : []
    );
    const dailyGroupDurationSeries = dailyDurationSeries.map((d) => ({
      date: d.date,
      avgMinutes: dailyGroupDurationByKey.get(d.date) ?? null,
    }));

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
    const topEmoji = (reactions: typeof myGivenReactions): EmojiCount | null => {
      const byEmoji = new Map<string, number>();
      for (const r of reactions) byEmoji.set(r.emoji, (byEmoji.get(r.emoji) ?? 0) + 1);
      let best: EmojiCount | null = null;
      for (const [emoji, count] of byEmoji) {
        if (!best || count > best.count) best = { emoji, count };
      }
      return best;
    };
    const mostSentEmoji = topEmoji(myGivenReactions);
    const mostReceivedEmoji = topEmoji(myReceivedReactions);

    return {
      fullName: me.fullName,
      currency: groupInfo.currency,
      requireCheckoutPhoto: groupInfo.requireCheckoutPhoto,
      monthlyConsistencySeries,
      monthlyGroupConsistencySeries,
      monthlyDurationSeries,
      monthlyGroupDurationSeries,
      weeklyConsistencySeries,
      weeklyGroupConsistencySeries,
      weeklyDurationSeries,
      weeklyGroupDurationSeries,
      dailyConsistencySeries,
      dailyGroupConsistencySeries,
      dailyDurationSeries,
      dailyGroupDurationSeries,
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
      mostSentEmoji,
      mostReceivedEmoji,
    };
  }, [records, membersChallenges, checkinsByUser, penaltiesByUser, rawReactions, groupInfo, userId, timezone]);

  return { stats, isLoading: recordsLoading || challengesLoading || extrasLoading, refresh };
}
