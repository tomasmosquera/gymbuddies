import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { enumerateMonths, getWeekBounds, getWeekBoundsForDateString, toBogotaDateString } from '@/lib/domain/dateUtils';
import { rankMembersByConsistency } from '@/lib/domain/attendance';
import { useGroupAttendanceRecords } from '@/hooks/useGroupAttendanceRecords';
import {
  MONTHLY_CHALLENGES,
  allWeekendsCompleted,
  anyWeekendCompleted,
  completedOnAnyHoliday,
  computeWeeklyMvpsByWeek,
  determineTopByCount,
  monthHasFixedHoliday,
  tallyMonth,
  tallyMvpWeeksByMonth,
  type ClosedWeekFacts,
  type MonthlyChallengeStatus,
  type MonthlyMemberContext,
} from '@/lib/domain/monthlyChallenges';

export interface MemberMonthlyChallenges {
  userId: string;
  fullName: string;
  statusesById: Record<string, MonthlyChallengeStatus>;
  totalXp: number;
}

function addDaysToDateString(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Evaluates the monthly challenges catalog (src/lib/domain/monthlyChallenges.ts)
 * for every active member of a group, across every calendar month since the
 * group existed. Computed live, same as the lifetime badges — no new table.
 * Cross-member facts (rank, weekly MVP, most-reacted) are computed once per
 * month/week here and threaded into each member's evaluation context.
 */
export function useGroupMonthlyChallenges(groupId: string | null) {
  const {
    records,
    groupCreatedDate,
    isLoading: recordsLoading,
    refresh: refreshRecords,
  } = useGroupAttendanceRecords(groupId);
  const [closedWeeksByUser, setClosedWeeksByUser] = useState<Map<string, ClosedWeekFacts[]>>(new Map());
  const [reactionsGivenByUserMonth, setReactionsGivenByUserMonth] = useState<Map<string, Map<string, number>>>(new Map());
  const [reactionsReceivedByUserMonth, setReactionsReceivedByUserMonth] = useState<Map<string, Map<string, number>>>(new Map());
  const [workoutMinutesByUser, setWorkoutMinutesByUser] = useState<Map<string, { date: string; minutes: number }[]>>(new Map());
  const [useDurationTiebreak, setUseDurationTiebreak] = useState(false);
  const [extrasLoading, setExtrasLoading] = useState(true);

  const refreshExtras = useCallback(async () => {
    if (!groupId) {
      setClosedWeeksByUser(new Map());
      setReactionsGivenByUserMonth(new Map());
      setReactionsReceivedByUserMonth(new Map());
      setWorkoutMinutesByUser(new Map());
      setUseDurationTiebreak(false);
      setExtrasLoading(false);
      return;
    }
    setExtrasLoading(true);
    const todayString = toBogotaDateString(new Date());

    const [resultsRes, reactionsRes, checkinsRes, groupRes] = await Promise.all([
      supabase
        .from('weekly_evaluation_results')
        .select('user_id, failed_days, penalty_charged, run:weekly_evaluation_runs(week_start_date)')
        .eq('group_id', groupId),
      supabase.from('checkin_reactions').select('user_id, created_at, checkin:checkins(user_id)').eq('group_id', groupId),
      supabase
        .from('checkins')
        .select('user_id, checkin_date, workout_minutes')
        .eq('group_id', groupId)
        .lte('checkin_date', todayString)
        .not('workout_minutes', 'is', null),
      supabase.from('groups').select('require_checkout_photo').eq('id', groupId).single(),
    ]);
    setUseDurationTiebreak(groupRes.data?.require_checkout_photo ?? false);

    const nextWorkoutMinutes = new Map<string, { date: string; minutes: number }[]>();
    for (const c of checkinsRes.data ?? []) {
      if (c.workout_minutes === null) continue;
      if (!nextWorkoutMinutes.has(c.user_id)) nextWorkoutMinutes.set(c.user_id, []);
      nextWorkoutMinutes.get(c.user_id)!.push({ date: c.checkin_date, minutes: c.workout_minutes });
    }
    setWorkoutMinutesByUser(nextWorkoutMinutes);

    const results = (resultsRes.data ?? []) as unknown as {
      user_id: string;
      failed_days: number;
      penalty_charged: number;
      run: { week_start_date: string } | null;
    }[];
    const nextClosedWeeks = new Map<string, ClosedWeekFacts[]>();
    for (const r of results) {
      if (!r.run) continue;
      if (!nextClosedWeeks.has(r.user_id)) nextClosedWeeks.set(r.user_id, []);
      nextClosedWeeks
        .get(r.user_id)!
        .push({ weekStartDate: r.run.week_start_date, failedDays: r.failed_days, penaltyCharged: r.penalty_charged });
    }
    setClosedWeeksByUser(nextClosedWeeks);

    const reactions = (reactionsRes.data ?? []) as unknown as {
      user_id: string;
      created_at: string;
      checkin: { user_id: string } | null;
    }[];
    const nextGiven = new Map<string, Map<string, number>>();
    const nextReceived = new Map<string, Map<string, number>>();
    for (const r of reactions) {
      const month = toBogotaDateString(new Date(r.created_at)).slice(0, 7);
      if (!nextGiven.has(r.user_id)) nextGiven.set(r.user_id, new Map());
      const givenByMonth = nextGiven.get(r.user_id)!;
      givenByMonth.set(month, (givenByMonth.get(month) ?? 0) + 1);

      if (r.checkin) {
        if (!nextReceived.has(r.checkin.user_id)) nextReceived.set(r.checkin.user_id, new Map());
        const receivedByMonth = nextReceived.get(r.checkin.user_id)!;
        receivedByMonth.set(month, (receivedByMonth.get(month) ?? 0) + 1);
      }
    }
    setReactionsGivenByUserMonth(nextGiven);
    setReactionsReceivedByUserMonth(nextReceived);

    setExtrasLoading(false);
  }, [groupId]);

  useEffect(() => {
    refreshExtras();
  }, [refreshExtras]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshRecords(), refreshExtras()]);
  }, [refreshRecords, refreshExtras]);

  const membersChallenges = useMemo<MemberMonthlyChallenges[]>(() => {
    if (records.length === 0 || !groupCreatedDate) return [];
    const todayString = toBogotaDateString(new Date());
    const currentMonth = todayString.slice(0, 7);
    const months = enumerateMonths(groupCreatedDate.slice(0, 7), currentMonth);
    const closedMonths = months.filter((m) => m < currentMonth);

    // --- Weekly MVP, computed once across the group's full history ---
    const firstWeekStart = getWeekBoundsForDateString(groupCreatedDate).weekStart;
    const lastWeekStart = getWeekBounds(new Date()).weekStart;
    const weekStarts: string[] = [];
    for (let cursor = firstWeekStart; cursor <= lastWeekStart; cursor = addDaysToDateString(cursor, 7)) {
      weekStarts.push(cursor);
    }
    const allWeekAttendance = weekStarts.flatMap((weekStart) => {
      const weekEnd = addDaysToDateString(weekStart, 6);
      return records
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
    const mvpTallyByMonth = tallyMvpWeeksByMonth(computeWeeklyMvpsByWeek(allWeekAttendance, useDurationTiebreak));

    // --- Per-month, per-member facts + cross-member rank/mostReacted ---
    let previousMonthRankByUserId = new Map<string, number>();
    const contextsByMonthByUser = new Map<string, Map<string, MonthlyMemberContext>>();

    for (const month of months) {
      const hasHoliday = monthHasFixedHoliday(month);
      const tallies = new Map(records.map((m) => [m.userId, tallyMonth(m.days.filter((d) => d.date.slice(0, 7) === month))]));
      const durationsInMonthByUserId = new Map(
        records.map((m) => [
          m.userId,
          (workoutMinutesByUser.get(m.userId) ?? []).filter((r) => r.date.slice(0, 7) === month).map((r) => r.minutes),
        ])
      );
      const totalDurationInMonthByUserId = new Map(
        [...durationsInMonthByUserId.entries()].map(([userId, minutes]) => [userId, minutes.reduce((sum, n) => sum + n, 0)])
      );
      const rankable = records
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
      const rankByUserId = rankMembersByConsistency(rankable, useDurationTiebreak);
      const mostReacted = new Set(
        determineTopByCount(
          records.map((m) => ({ userId: m.userId, count: reactionsReceivedByUserMonth.get(m.userId)?.get(month) ?? 0 }))
        )
      );
      const mostDuration = new Set(
        determineTopByCount(records.map((m) => ({ userId: m.userId, count: totalDurationInMonthByUserId.get(m.userId) ?? 0 })))
      );
      const mvpTallyThisMonth = mvpTallyByMonth.get(month) ?? new Map<string, number>();

      const byUser = new Map<string, MonthlyMemberContext>();
      for (const m of records) {
        const daysInMonth = m.days.filter((d) => d.date.slice(0, 7) === month);
        const { completed, failed, percent } = tallies.get(m.userId)!;
        const durations = durationsInMonthByUserId.get(m.userId) ?? [];
        const totalWorkoutMinutesInMonth = totalDurationInMonthByUserId.get(m.userId) ?? 0;
        byUser.set(m.userId, {
          completedCount: completed,
          failedCount: failed,
          consistencyPercent: percent,
          closedWeeksInMonth: (closedWeeksByUser.get(m.userId) ?? []).filter((w) => w.weekStartDate.slice(0, 7) === month),
          monthHasFixedHoliday: hasHoliday,
          completedOnHoliday: completedOnAnyHoliday(daysInMonth),
          allWeekendsCompleted: allWeekendsCompleted(daysInMonth),
          anyWeekendCompleted: anyWeekendCompleted(daysInMonth),
          reactionsGivenCount: reactionsGivenByUserMonth.get(m.userId)?.get(month) ?? 0,
          rank: rankByUserId.get(m.userId) ?? null,
          previousMonthRank: previousMonthRankByUserId.get(m.userId) ?? null,
          isMostReactedThisMonth: mostReacted.has(m.userId),
          mvpWeeksThisMonth: mvpTallyThisMonth.get(m.userId) ?? 0,
          groupRequiresCheckoutPhoto: useDurationTiebreak,
          totalWorkoutMinutesInMonth,
          averageWorkoutMinutesInMonth: durations.length > 0 ? totalWorkoutMinutesInMonth / durations.length : 0,
          workoutSessionsWithDurationInMonth: durations.length,
          isMostDurationThisMonth: mostDuration.has(m.userId),
        });
      }
      contextsByMonthByUser.set(month, byUser);
      previousMonthRankByUserId = rankByUserId;
    }

    return records.map((m) => {
      const statusesById: Record<string, MonthlyChallengeStatus> = {};
      let totalXp = 0;
      for (const challengeDef of MONTHLY_CHALLENGES) {
        let timesAchieved = 0;
        let monthsEvaluated = 0;
        // Monotonic challenges (counters that only grow within a month) are
        // credited the moment they're met — including the still-open current
        // month — instead of waiting for month-close like comparative/
        // rank-based challenges, which could still flip later in the month.
        const evalMonths = challengeDef.monotonic ? months : closedMonths;
        for (const month of evalMonths) {
          const ctx = contextsByMonthByUser.get(month)?.get(m.userId);
          if (!ctx) continue;
          const result = challengeDef.evaluate(ctx);
          if (result === null) continue;
          monthsEvaluated++;
          if (result) timesAchieved++;
        }
        const currentCtx = contextsByMonthByUser.get(currentMonth)?.get(m.userId);
        const currentMonthEarned = currentCtx ? challengeDef.evaluate(currentCtx) : null;
        statusesById[challengeDef.id] = { timesAchieved, monthsEvaluated, currentMonthEarned };
        totalXp += timesAchieved * challengeDef.xpPerOccurrence;
      }
      return { userId: m.userId, fullName: m.fullName, statusesById, totalXp };
    });
  }, [
    records,
    groupCreatedDate,
    closedWeeksByUser,
    reactionsGivenByUserMonth,
    reactionsReceivedByUserMonth,
    workoutMinutesByUser,
    useDurationTiebreak,
  ]);

  return { membersChallenges, isLoading: recordsLoading || extrasLoading, refresh };
}
