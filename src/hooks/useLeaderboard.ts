import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds, toZonedDateString } from '@/lib/domain/dateUtils';
import { consistencyPercent, gbScore, rankMembersByConsistency, tallyAttendance } from '@/lib/domain/attendance';
import { daysPresentInWeek } from '@/lib/domain/weeklyEvaluation';
import { useGroupAttendanceRecords, type MemberAttendanceRecord } from '@/hooks/useGroupAttendanceRecords';
import { fetchCurrentLeagueCycleBounds } from '@/hooks/useCurrentLeagueCycleBounds';
import type { PayoutMode } from '@/lib/supabase/types';

/**
 * 'cycle' only means something for League/Mixto (scoped to the currently
 * running league_cycles row — falls back to an empty range, same shape as
 * "no data yet", when there isn't one). 'total' is the old unbounded
 * all-time view every period used to call "Acumulado" before the split.
 * Cooperativo groups only ever read 'total' — the caller/UI is responsible
 * for not exposing a 'cycle' tab there.
 */
export type LeaderboardPeriod = 'week' | 'month' | 'cycle' | 'total';

export interface LeaderboardRow {
  userId: string;
  fullName: string;
  completedDays: number;
  failedDays: number;
  /** completedDays / (completedDays + failedDays) — null until this member has any decided day yet. Purely informational; see gbScore for what actually drives rank. */
  consistencyPercent: number | null;
  /** Wilson score lower bound (80% confidence) on the same ratio — what `rank` below is actually sorted by. Rewards a track record backed by more days, not just a high ratio over few of them. */
  gbScore: number | null;
  /** Money charged this period (or, for the still-open current week, a live projection) — never negative. Never used for ranking. */
  chargedAmount: number;
  /** 1-based rank by GB Score alone — no tiebreak of any kind, so a genuine tie shares the rank. Money never factors in. */
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
  payoutMode: PayoutMode;
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
 * Ranking itself is by GB Score alone (never balance/money) — see
 * rankMembersByConsistency. chargedAmount is purely informational: how
 * much money this member owes for this period (frozen weekly_evaluation_results
 * for closed weeks, a live guaranteed-misses-only projection for the still-open
 * current week, converted to money via the group's penalty_amount/weekly_penalty_cap).
 */
export function useLeaderboard(groupId: string | null, timezone: string, referenceDate: Date = new Date()) {
  const { records, isLoading: recordsLoading, refresh: refreshRecords } = useGroupAttendanceRecords(groupId, timezone);
  const [monthChargedAmountByUser, setMonthChargedAmountByUser] = useState<Record<string, number>>({});
  const [allChargedAmountByUser, setAllChargedAmountByUser] = useState<Record<string, number>>({});
  const [cycleChargedAmountByUser, setCycleChargedAmountByUser] = useState<Record<string, number>>({});
  const [cycleStartDate, setCycleStartDate] = useState<string | null>(null);
  // Per-week frozen amounts, for viewing a past week's already-decided
  // charge instead of the current week's live guaranteed-misses projection.
  const [weeklyChargedAmountByWeekStart, setWeeklyChargedAmountByWeekStart] = useState<Record<string, Record<string, number>>>(
    {}
  );
  const [groupRules, setGroupRules] = useState<GroupRankingRules | null>(null);
  const [lastClosedWeek, setLastClosedWeek] = useState<LastClosedWeekSummary | null>(null);
  const [resultsLoading, setResultsLoading] = useState(true);

  const refreshResults = useCallback(async () => {
    if (!groupId) {
      setMonthChargedAmountByUser({});
      setAllChargedAmountByUser({});
      setCycleChargedAmountByUser({});
      setCycleStartDate(null);
      setWeeklyChargedAmountByWeekStart({});
      setGroupRules(null);
      setLastClosedWeek(null);
      setResultsLoading(false);
      return;
    }
    setResultsLoading(true);
    const { monthStart } = currentMonthBounds(timezone);

    const [resultsRes, groupRes, cycleBounds] = await Promise.all([
      supabase
        .from('weekly_evaluation_results')
        .select('user_id, failed_days, penalty_charged, run:weekly_evaluation_runs(week_start_date, week_end_date)')
        .eq('group_id', groupId),
      supabase.from('groups').select('penalty_amount, weekly_penalty_cap, payout_mode').eq('id', groupId).single(),
      fetchCurrentLeagueCycleBounds(groupId, timezone),
    ]);
    setCycleStartDate(cycleBounds?.startDate ?? null);

    const results = (resultsRes.data ?? []) as unknown as {
      user_id: string;
      failed_days: number;
      penalty_charged: number;
      run: { week_start_date: string; week_end_date: string } | null;
    }[];

    const monthChargedAmount: Record<string, number> = {};
    const allChargedAmount: Record<string, number> = {};
    const cycleChargedAmount: Record<string, number> = {};
    const weeklyChargedAmount: Record<string, Record<string, number>> = {};
    let lastRun: { week_start_date: string; week_end_date: string } | null = null;
    for (const r of results) {
      allChargedAmount[r.user_id] = (allChargedAmount[r.user_id] ?? 0) + r.penalty_charged;
      if (r.run && r.run.week_start_date >= monthStart) {
        monthChargedAmount[r.user_id] = (monthChargedAmount[r.user_id] ?? 0) + r.penalty_charged;
      }
      if (cycleBounds && r.run && r.run.week_start_date >= cycleBounds.startDate) {
        cycleChargedAmount[r.user_id] = (cycleChargedAmount[r.user_id] ?? 0) + r.penalty_charged;
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
    setCycleChargedAmountByUser(cycleChargedAmount);
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

    setGroupRules(
      groupRes.data
        ? {
            penaltyAmount: groupRes.data.penalty_amount,
            weeklyPenaltyCap: groupRes.data.weekly_penalty_cap,
            payoutMode: groupRes.data.payout_mode,
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

    // League mode never charges a penalty (run_weekly_evaluation forces it to
    // 0 there, only ranking/podium money moves) — this live projection must
    // agree, or a league member sees a scary "-$X" that can never actually
    // be charged.
    const liveChargedAmount = (m: MemberAttendanceRecord): number => {
      if (!groupRules || groupRules.payoutMode === 'league') return 0;
      return Math.min(liveChargedFailedDays(m) * groupRules.penaltyAmount, groupRules.weeklyPenaltyCap);
    };

    const buildRows = (rangeStart: string, rangeEnd: string, chargedAmountFn: (m: MemberAttendanceRecord) => number): LeaderboardRow[] => {
      const raw = records.map((m) => {
        const statuses = m.days.filter((d) => d.date >= rangeStart && d.date <= rangeEnd).map((d) => d.status);
        const tally = tallyAttendance(statuses);
        return {
          userId: m.userId,
          fullName: m.fullName,
          completedDays: tally.completedCount,
          failedDays: tally.failedCount,
          consistencyPercent: consistencyPercent(tally.completedCount, tally.failedCount),
          gbScore: gbScore(tally.completedCount, tally.failedCount),
          chargedAmount: chargedAmountFn(m),
          penaltyProtectedUntil: m.penaltyStartDate && m.penaltyStartDate > todayString ? m.penaltyStartDate : null,
        };
      });
      const rankByUserId = rankMembersByConsistency(
        raw.map((r) => ({ userId: r.userId, completedCount: r.completedDays, failedCount: r.failedDays }))
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
    const total = buildRows('0001-01-01', todayString, (m) => (allChargedAmountByUser[m.userId] ?? 0) + liveChargedAmount(m));
    // No running cycle (Cooperativo, or League/Mixto between cycles) —
    // rangeStart after rangeEnd means every day filter comes up empty, so
    // this reads as "no data yet" rather than silently falling back to
    // all-time (which would make Ciclo and Total look identical and hide
    // that there's simply nothing running right now).
    const cycle = cycleStartDate
      ? buildRows(cycleStartDate, todayString, (m) => (cycleChargedAmountByUser[m.userId] ?? 0) + liveChargedAmount(m))
      : buildRows(todayString, '0001-01-01', () => 0);

    return { week, month, cycle, total };
  }, [
    records,
    monthChargedAmountByUser,
    allChargedAmountByUser,
    cycleChargedAmountByUser,
    cycleStartDate,
    weeklyChargedAmountByWeekStart,
    groupRules,
    referenceDate,
    timezone,
  ]);

  return { rowsByPeriod, lastClosedWeek: resolvedLastClosedWeek, isLoading: recordsLoading || resultsLoading, refresh };
}
