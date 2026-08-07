import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds, toZonedDateString } from '@/lib/domain/dateUtils';
import { consistencyPercent, rankMembersByConsistency, tallyAttendance } from '@/lib/domain/attendance';
import { daysPresentInWeek } from '@/lib/domain/weeklyEvaluation';
import { useGroupAttendanceRecords, type MemberAttendanceRecord } from '@/hooks/useGroupAttendanceRecords';

export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardRow {
  userId: string;
  fullName: string;
  completedDays: number;
  failedDays: number;
  /** completedDays / (completedDays + failedDays) — null until this member has any decided day yet. */
  consistencyPercent: number | null;
  /** Money charged this period (or, for the still-open current week, a live projection) — never negative. Never used for ranking. */
  chargedAmount: number;
  /** Sum of workout minutes in this period — always 0 if the group doesn't require checkout photos, since duration is never recorded then. */
  totalWorkoutMinutes: number;
  /** 1-based rank by consistency percent, then (only if the group requires checkout photos) total workout duration. Ties share a rank; money never factors in. */
  rank: number;
  /** True right now if this member's penalty_start_date is still in the future — so a $0 charge reads as "protected", not "perfect". */
  penaltyProtectedUntil: string | null;
}

export interface LastClosedWeekSummary {
  weekStart: string;
  weekEnd: string;
  losers: string[];
}

interface GroupRankingRules {
  penaltyAmount: number;
  weeklyPenaltyCap: number;
  requireCheckoutPhoto: boolean;
}

function currentMonthBounds(timezone: string): { monthStart: string } {
  const todayString = toZonedDateString(new Date(), timezone);
  const [year, month] = todayString.split('-');
  return { monthStart: `${year}-${month}-01` };
}

/** How many days of the current week (today included) are still available to check in. */
function daysRemainingInWeek(weekEnd: string, todayString: string): number {
  const endMs = Date.parse(`${weekEnd}T00:00:00Z`);
  const todayMs = Date.parse(`${todayString}T00:00:00Z`);
  const diffDays = Math.round((endMs - todayMs) / (24 * 60 * 60 * 1000));
  return Math.max(diffDays + 1, 0);
}

/**
 * Ranks a group's members for the home-screen leaderboard, day by day —
 * completedDays/failedDays/consistencyPercent come from useGroupAttendanceRecords,
 * which uses the exact same classifyMemberDay rule the Dashboard's attendance
 * view already applies (see src/lib/domain/attendance.ts), so the two screens
 * can never show different numbers for "how many days did you fail" again.
 *
 * Ranking itself is by consistency percent alone (never balance/money) —
 * see rankMembersByConsistency. chargedAmount is purely informational: how
 * much money this member owes for this period (frozen weekly_evaluation_results
 * for closed weeks, a live guaranteed-misses-only projection for the still-open
 * current week, converted to money via the group's penalty_amount/weekly_penalty_cap).
 */
export function useLeaderboard(groupId: string | null, timezone: string, referenceDate: Date = new Date()) {
  const { records, isLoading: recordsLoading, refresh: refreshRecords } = useGroupAttendanceRecords(groupId, timezone);
  const [monthChargedAmountByUser, setMonthChargedAmountByUser] = useState<Record<string, number>>({});
  const [allChargedAmountByUser, setAllChargedAmountByUser] = useState<Record<string, number>>({});
  // Per-week frozen amounts, for viewing a past week's already-decided
  // charge instead of the current week's live guaranteed-misses projection.
  const [weeklyChargedAmountByWeekStart, setWeeklyChargedAmountByWeekStart] = useState<Record<string, Record<string, number>>>(
    {}
  );
  const [workoutMinutesByUser, setWorkoutMinutesByUser] = useState<Map<string, { date: string; minutes: number }[]>>(new Map());
  const [groupRules, setGroupRules] = useState<GroupRankingRules | null>(null);
  const [lastClosedWeek, setLastClosedWeek] = useState<LastClosedWeekSummary | null>(null);
  const [resultsLoading, setResultsLoading] = useState(true);

  const refreshResults = useCallback(async () => {
    if (!groupId) {
      setMonthChargedAmountByUser({});
      setAllChargedAmountByUser({});
      setWeeklyChargedAmountByWeekStart({});
      setWorkoutMinutesByUser(new Map());
      setGroupRules(null);
      setLastClosedWeek(null);
      setResultsLoading(false);
      return;
    }
    setResultsLoading(true);
    const { monthStart } = currentMonthBounds(timezone);
    const todayString = toZonedDateString(new Date(), timezone);

    const [resultsRes, checkinsRes, groupRes] = await Promise.all([
      supabase
        .from('weekly_evaluation_results')
        .select('user_id, failed_days, penalty_charged, run:weekly_evaluation_runs(week_start_date, week_end_date)')
        .eq('group_id', groupId),
      supabase
        .from('checkins')
        .select('user_id, checkin_date, workout_minutes')
        .eq('group_id', groupId)
        .lte('checkin_date', todayString)
        .not('workout_minutes', 'is', null),
      supabase.from('groups').select('penalty_amount, weekly_penalty_cap, require_checkout_photo').eq('id', groupId).single(),
    ]);

    const results = (resultsRes.data ?? []) as unknown as {
      user_id: string;
      failed_days: number;
      penalty_charged: number;
      run: { week_start_date: string; week_end_date: string } | null;
    }[];

    const monthChargedAmount: Record<string, number> = {};
    const allChargedAmount: Record<string, number> = {};
    const weeklyChargedAmount: Record<string, Record<string, number>> = {};
    let lastRun: { week_start_date: string; week_end_date: string } | null = null;
    for (const r of results) {
      allChargedAmount[r.user_id] = (allChargedAmount[r.user_id] ?? 0) + r.penalty_charged;
      if (r.run && r.run.week_start_date >= monthStart) {
        monthChargedAmount[r.user_id] = (monthChargedAmount[r.user_id] ?? 0) + r.penalty_charged;
      }
      if (r.run) {
        if (!weeklyChargedAmount[r.run.week_start_date]) weeklyChargedAmount[r.run.week_start_date] = {};
        weeklyChargedAmount[r.run.week_start_date][r.user_id] =
          (weeklyChargedAmount[r.run.week_start_date][r.user_id] ?? 0) + r.penalty_charged;
      }
      if (r.run && (!lastRun || r.run.week_end_date > lastRun.week_end_date)) {
        lastRun = r.run;
      }
    }
    setMonthChargedAmountByUser(monthChargedAmount);
    setAllChargedAmountByUser(allChargedAmount);
    setWeeklyChargedAmountByWeekStart(weeklyChargedAmount);
    setLastClosedWeek(
      lastRun
        ? {
            weekStart: lastRun.week_start_date,
            weekEnd: lastRun.week_end_date,
            losers: results
              .filter((r) => r.run?.week_start_date === lastRun!.week_start_date && r.run?.week_end_date === lastRun!.week_end_date)
              .filter((r) => r.failed_days > 0)
              .map((r) => r.user_id),
          }
        : null
    );

    const nextWorkoutMinutes = new Map<string, { date: string; minutes: number }[]>();
    for (const c of checkinsRes.data ?? []) {
      if (c.workout_minutes === null) continue;
      if (!nextWorkoutMinutes.has(c.user_id)) nextWorkoutMinutes.set(c.user_id, []);
      nextWorkoutMinutes.get(c.user_id)!.push({ date: c.checkin_date, minutes: c.workout_minutes });
    }
    setWorkoutMinutesByUser(nextWorkoutMinutes);

    setGroupRules(
      groupRes.data
        ? {
            penaltyAmount: groupRes.data.penalty_amount,
            weeklyPenaltyCap: groupRes.data.weekly_penalty_cap,
            requireCheckoutPhoto: groupRes.data.require_checkout_photo,
          }
        : null
    );

    setResultsLoading(false);
  }, [groupId, timezone]);

  useEffect(() => {
    refreshResults();
  }, [refreshResults]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshRecords(), refreshResults()]);
  }, [refreshRecords, refreshResults]);

  // lastClosedWeek.losers is stored as userIds above (no name lookup at fetch
  // time, since the results fetch and the records fetch can land in either
  // order); resolved to names here once both are available.
  const resolvedLastClosedWeek = useMemo<LastClosedWeekSummary | null>(() => {
    if (!lastClosedWeek) return null;
    return {
      ...lastClosedWeek,
      losers: lastClosedWeek.losers.map((userId) => records.find((m) => m.userId === userId)?.fullName ?? 'Miembro'),
    };
  }, [lastClosedWeek, records]);

  const rowsByPeriod = useMemo(() => {
    const { weekStart, weekEnd } = getWeekBounds(referenceDate, timezone);
    const todayString = toZonedDateString(new Date(), timezone);
    const isCurrentWeek = weekStart === getWeekBounds(new Date(), timezone).weekStart;
    const remainingDays = daysRemainingInWeek(weekEnd, todayString);
    const { monthStart } = currentMonthBounds(timezone);
    const useDurationTiebreak = groupRules?.requireCheckoutPhoto ?? false;

    // Guaranteed-misses-only projection for the still-open current week —
    // see the doc comment above for why this can't just be "required - completed".
    // requiredDays is clamped to how many days of *this* week the member was
    // even penalty-eligible for (mirrors run_weekly_evaluation's parallel
    // penalty-quota calculation, keyed off penaltyStartDate rather than
    // activatedDate) — a member still within their penalty grace period
    // must never show a live projected charge, even if they're missing days
    // for consistency purposes.
    const liveChargedFailedDays = (m: MemberAttendanceRecord): number => {
      const weekDays = m.days.filter((d) => d.date >= weekStart && d.date <= weekEnd);
      const completed = weekDays.filter((d) => d.status === 'completed').length;
      const excused = weekDays.filter((d) => d.status === 'excused').length;
      const presentDays = m.penaltyStartDate ? daysPresentInWeek(m.penaltyStartDate, weekStart, weekEnd) : 7;
      const requiredDays = Math.min(m.minDaysPerWeek, presentDays);
      const effectiveRequired = Math.max(requiredDays - excused, 0);
      const stillNeeded = Math.max(effectiveRequired - completed, 0);
      return Math.max(stillNeeded - remainingDays, 0);
    };

    const liveChargedAmount = (m: MemberAttendanceRecord): number => {
      if (!groupRules) return 0;
      return Math.min(liveChargedFailedDays(m) * groupRules.penaltyAmount, groupRules.weeklyPenaltyCap);
    };

    const buildRows = (rangeStart: string, rangeEnd: string, chargedAmountFn: (m: MemberAttendanceRecord) => number): LeaderboardRow[] => {
      const raw = records.map((m) => {
        const statuses = m.days.filter((d) => d.date >= rangeStart && d.date <= rangeEnd).map((d) => d.status);
        const tally = tallyAttendance(statuses);
        // A workout logged before this member's own activation date is
        // practice, not real play — must not sway the duration tiebreak any
        // more than it sways completedDays/failedDays above (m.days already
        // excludes those dates; this map doesn't, since it's built from a
        // separate raw checkins query keyed only by date range).
        const totalWorkoutMinutes = (workoutMinutesByUser.get(m.userId) ?? [])
          .filter((r) => r.date >= rangeStart && r.date <= rangeEnd && (!m.activatedDate || r.date >= m.activatedDate))
          .reduce((sum, r) => sum + r.minutes, 0);
        return {
          userId: m.userId,
          fullName: m.fullName,
          completedDays: tally.completedCount,
          failedDays: tally.failedCount,
          consistencyPercent: consistencyPercent(tally.completedCount, tally.failedCount),
          chargedAmount: chargedAmountFn(m),
          totalWorkoutMinutes,
          penaltyProtectedUntil: m.penaltyStartDate && m.penaltyStartDate > todayString ? m.penaltyStartDate : null,
        };
      });
      const rankByUserId = rankMembersByConsistency(
        raw.map((r) => ({
          userId: r.userId,
          completedCount: r.completedDays,
          failedCount: r.failedDays,
          totalWorkoutMinutes: r.totalWorkoutMinutes,
        })),
        useDurationTiebreak
      );
      return raw
        .map((r) => ({ ...r, rank: rankByUserId.get(r.userId)! }))
        .sort((a, b) => a.rank - b.rank || a.fullName.localeCompare(b.fullName));
    };

    // The still-open current week gets the live guaranteed-misses projection;
    // any other (past) week already has a frozen, decided amount instead.
    const weekChargedAmount = isCurrentWeek
      ? liveChargedAmount
      : (m: MemberAttendanceRecord) => weeklyChargedAmountByWeekStart[weekStart]?.[m.userId] ?? 0;

    const week = buildRows(weekStart, weekEnd, weekChargedAmount);
    const month = buildRows(monthStart, todayString, (m) => (monthChargedAmountByUser[m.userId] ?? 0) + liveChargedAmount(m));
    const all = buildRows('0001-01-01', todayString, (m) => (allChargedAmountByUser[m.userId] ?? 0) + liveChargedAmount(m));

    return { week, month, all };
  }, [
    records,
    monthChargedAmountByUser,
    allChargedAmountByUser,
    weeklyChargedAmountByWeekStart,
    workoutMinutesByUser,
    groupRules,
    referenceDate,
    timezone,
  ]);

  return { rowsByPeriod, lastClosedWeek: resolvedLastClosedWeek, isLoading: recordsLoading || resultsLoading, refresh };
}
