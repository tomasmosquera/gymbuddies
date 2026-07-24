import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { enumerateDates, getWeekBounds, toBogotaDateString } from '@/lib/domain/dateUtils';
import { classifyMemberDay, tallyAttendance, type DayAttendanceStatus } from '@/lib/domain/attendance';

export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardRow {
  userId: string;
  fullName: string;
  balance: number;
  completedDays: number;
  failedDays: number;
  /** completedDays / (completedDays + failedDays) — null until this member has any decided day yet. */
  consistencyPercent: number | null;
  /** How many of the group's *required* days were actually missed (capped per week) — what real penalties are charged on. Always <= failedDays. */
  chargedFailedDays: number;
  /** completedDays - failedDays — the ranking metric: most attendance, fewest fails wins. */
  score: number;
}

export interface LastClosedWeekSummary {
  weekStart: string;
  weekEnd: string;
  losers: string[];
}

interface RosterEntry {
  userId: string;
  fullName: string;
  balance: number;
  minDaysPerWeek: number;
  activatedDate: string | null;
}

interface DayRecord {
  date: string;
  status: DayAttendanceStatus;
}

function activatedDateOf(m: { activated_at: string | null; joined_at: string }): string | null {
  const activatedAt = m.activated_at ?? m.joined_at;
  return activatedAt ? toBogotaDateString(new Date(activatedAt)) : null;
}

function currentMonthBounds(): { monthStart: string } {
  const todayString = toBogotaDateString(new Date());
  const [year, month] = todayString.split('-');
  return { monthStart: `${year}-${month}-01` };
}

function sortByScore(rows: LeaderboardRow[]): LeaderboardRow[] {
  return [...rows].sort(
    (a, b) => b.score - a.score || b.completedDays - a.completedDays || b.balance - a.balance
  );
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
 * completedDays/failedDays/consistencyPercent use the exact same
 * classifyMemberDay rule the Dashboard's attendance view already applies
 * (see src/lib/domain/attendance.ts), so the two screens can never show
 * different numbers for "how many days did you fail" again. A day before a
 * member's own activation date is simply never in their range.
 *
 * chargedFailedDays is a different, narrower number: how many of the
 * group's *required* days (min_days_per_week, capped per week, excused
 * days already subtracted) were actually missed — the same figure
 * run_weekly_evaluation charges real penalties on. For weeks that already
 * closed this comes straight from the frozen weekly_evaluation_results; for
 * the still-open current week it's a live projection of GUARANTEED misses
 * only (days still left this week could still be completed, so nothing
 * counts here until it's mathematically impossible to reach the
 * excused-adjusted requirement anymore).
 */
export function useLeaderboard(groupId: string | null) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [dayRecordsByUser, setDayRecordsByUser] = useState<Map<string, DayRecord[]>>(new Map());
  const [monthChargedFailedByUser, setMonthChargedFailedByUser] = useState<Record<string, number>>({});
  const [allChargedFailedByUser, setAllChargedFailedByUser] = useState<Record<string, number>>({});
  const [lastClosedWeek, setLastClosedWeek] = useState<LastClosedWeekSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRoster([]);
      setDayRecordsByUser(new Map());
      setMonthChargedFailedByUser({});
      setAllChargedFailedByUser({});
      setLastClosedWeek(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const todayString = toBogotaDateString(new Date());
    const { monthStart } = currentMonthBounds();

    const [membersRes, checkinsRes, excusedRes, overridesRes, resultsRes] = await Promise.all([
      supabase
        .from('group_members')
        .select('user_id, balance, activated_at, joined_at, profile:profiles(full_name), group:groups(min_days_per_week, created_at)')
        .eq('group_id', groupId)
        .in('status', ['active', 'needs_recharge']),
      // No lower bound needed — a check-in can't predate the group itself.
      supabase.from('checkins').select('user_id, checkin_date').eq('group_id', groupId).lte('checkin_date', todayString),
      supabase.from('excuse_dates').select('user_id, excused_date').eq('group_id', groupId).lte('excused_date', todayString),
      supabase
        .from('attendance_overrides')
        .select('user_id, override_date, status')
        .eq('group_id', groupId)
        .lte('override_date', todayString),
      // All weekly_evaluation_results ever, with the run's week bounds embedded —
      // used for chargedFailedDays (month/all) and the last-closed-week summary.
      supabase
        .from('weekly_evaluation_results')
        .select('user_id, failed_days, run:weekly_evaluation_runs(week_start_date, week_end_date)')
        .eq('group_id', groupId),
    ]);

    const members = (membersRes.data ?? []) as unknown as {
      user_id: string;
      balance: number;
      activated_at: string | null;
      joined_at: string;
      profile: { full_name: string } | null;
      group: { min_days_per_week: number; created_at: string } | null;
    }[];

    const rosterEntries: RosterEntry[] = members.map((m) => ({
      userId: m.user_id,
      fullName: m.profile?.full_name ?? 'Miembro',
      balance: m.balance,
      minDaysPerWeek: m.group?.min_days_per_week ?? 0,
      activatedDate: activatedDateOf(m),
    }));
    setRoster(rosterEntries);

    const groupCreatedDate = members[0]?.group?.created_at
      ? toBogotaDateString(new Date(members[0].group.created_at))
      : todayString;

    const checkinDatesByUser = new Map<string, Set<string>>();
    for (const c of checkinsRes.data ?? []) {
      if (!checkinDatesByUser.has(c.user_id)) checkinDatesByUser.set(c.user_id, new Set());
      checkinDatesByUser.get(c.user_id)!.add(c.checkin_date);
    }

    const validOverridesByUser = new Map<string, Set<string>>();
    const failedOverridesByUser = new Map<string, Set<string>>();
    for (const o of overridesRes.data ?? []) {
      const target = o.status === 'valid' ? validOverridesByUser : failedOverridesByUser;
      if (!target.has(o.user_id)) target.set(o.user_id, new Set());
      target.get(o.user_id)!.add(o.override_date);
    }

    const excusedDatesByUser = new Map<string, Set<string>>();
    for (const e of excusedRes.data ?? []) {
      if (!excusedDatesByUser.has(e.user_id)) excusedDatesByUser.set(e.user_id, new Set());
      excusedDatesByUser.get(e.user_id)!.add(e.excused_date);
    }

    // Every day since the group existed, today included — a check-in
    // already done today still counts right away, same as the dashboard.
    const allDates = enumerateDates(groupCreatedDate, todayString);

    const dayRecords = new Map<string, DayRecord[]>();
    for (const m of rosterEntries) {
      const checkinDates = checkinDatesByUser.get(m.userId);
      const validDates = validOverridesByUser.get(m.userId);
      const failedDates = failedOverridesByUser.get(m.userId);
      const excusedDates = excusedDatesByUser.get(m.userId);
      const records: DayRecord[] = [];
      for (const date of allDates) {
        if (m.activatedDate && m.activatedDate > date) continue;
        const status = classifyMemberDay({
          hasCheckin: checkinDates?.has(date) ?? false,
          hasValidOverride: validDates?.has(date) ?? false,
          hasFailedOverride: failedDates?.has(date) ?? false,
          isExcused: excusedDates?.has(date) ?? false,
        });
        // Today isn't over yet — it can still show as completed/excused,
        // but never as failed until the day has actually passed.
        if (status === 'failed' && date === todayString) continue;
        records.push({ date, status });
      }
      dayRecords.set(m.userId, records);
    }
    setDayRecordsByUser(dayRecords);

    const results = (resultsRes.data ?? []) as unknown as {
      user_id: string;
      failed_days: number;
      run: { week_start_date: string; week_end_date: string } | null;
    }[];

    const monthChargedFailed: Record<string, number> = {};
    const allChargedFailed: Record<string, number> = {};
    let lastRun: { week_start_date: string; week_end_date: string } | null = null;
    for (const r of results) {
      allChargedFailed[r.user_id] = (allChargedFailed[r.user_id] ?? 0) + r.failed_days;
      if (r.run && r.run.week_start_date >= monthStart) {
        monthChargedFailed[r.user_id] = (monthChargedFailed[r.user_id] ?? 0) + r.failed_days;
      }
      if (r.run && (!lastRun || r.run.week_end_date > lastRun.week_end_date)) {
        lastRun = r.run;
      }
    }
    setMonthChargedFailedByUser(monthChargedFailed);
    setAllChargedFailedByUser(allChargedFailed);

    if (lastRun) {
      const losers = results
        .filter((r) => r.run?.week_start_date === lastRun!.week_start_date && r.run?.week_end_date === lastRun!.week_end_date)
        .filter((r) => r.failed_days > 0)
        .map((r) => rosterEntries.find((m) => m.userId === r.user_id)?.fullName ?? 'Miembro');
      setLastClosedWeek({ weekStart: lastRun.week_start_date, weekEnd: lastRun.week_end_date, losers });
    } else {
      setLastClosedWeek(null);
    }

    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rowsByPeriod = useMemo(() => {
    const { weekStart, weekEnd } = getWeekBounds(new Date());
    const todayString = toBogotaDateString(new Date());
    const remainingDays = daysRemainingInWeek(weekEnd, todayString);
    const { monthStart } = currentMonthBounds();

    const buildRow = (m: RosterEntry, rangeStart: string, rangeEnd: string, chargedFailedDays: number): LeaderboardRow => {
      const records = dayRecordsByUser.get(m.userId) ?? [];
      const statuses = records
        .filter((r) => r.date >= rangeStart && r.date <= rangeEnd)
        .map((r) => r.status);
      const tally = tallyAttendance(statuses);
      return {
        userId: m.userId,
        fullName: m.fullName,
        balance: m.balance,
        completedDays: tally.completedCount,
        failedDays: tally.failedCount,
        consistencyPercent: tally.decidedDays > 0 ? Math.round((tally.completedCount / tally.decidedDays) * 100) : null,
        chargedFailedDays,
        score: tally.completedCount - tally.failedCount,
      };
    };

    // Guaranteed-misses-only projection for the still-open current week —
    // see the doc comment above for why this can't just be "required - completed".
    const liveChargedFailed = (m: RosterEntry): number => {
      const records = dayRecordsByUser.get(m.userId) ?? [];
      const weekRecords = records.filter((r) => r.date >= weekStart && r.date <= weekEnd);
      const completed = weekRecords.filter((r) => r.status === 'completed').length;
      const excused = weekRecords.filter((r) => r.status === 'excused').length;
      const effectiveRequired = Math.max(m.minDaysPerWeek - excused, 0);
      const stillNeeded = Math.max(effectiveRequired - completed, 0);
      return Math.max(stillNeeded - remainingDays, 0);
    };

    const week = sortByScore(roster.map((m) => buildRow(m, weekStart, weekEnd, liveChargedFailed(m))));
    const month = sortByScore(
      roster.map((m) => buildRow(m, monthStart, todayString, (monthChargedFailedByUser[m.userId] ?? 0) + liveChargedFailed(m)))
    );
    const all = sortByScore(
      roster.map((m) => buildRow(m, '0001-01-01', todayString, (allChargedFailedByUser[m.userId] ?? 0) + liveChargedFailed(m)))
    );

    return { week, month, all };
  }, [roster, dayRecordsByUser, monthChargedFailedByUser, allChargedFailedByUser]);

  return { rowsByPeriod, lastClosedWeek, isLoading, refresh };
}
