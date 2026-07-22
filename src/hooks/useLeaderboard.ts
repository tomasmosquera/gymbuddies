import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getWeekBounds, toBogotaDateString } from '@/lib/domain/dateUtils';

function activatedDateOf(m: { activated_at: string | null; joined_at: string }): string | null {
  const activatedAt = m.activated_at ?? m.joined_at;
  return activatedAt ? toBogotaDateString(new Date(activatedAt)) : null;
}

export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardRow {
  userId: string;
  fullName: string;
  balance: number;
  completedDays: number;
  failedDays: number;
  /** completedDays - failedDays — the ranking metric: most attendance, fewest fails wins. */
  score: number;
}

interface RosterEntry {
  userId: string;
  fullName: string;
  balance: number;
  minDaysPerWeek: number;
}

function currentMonthBounds(): { monthStart: string; monthEnd: string } {
  const todayString = toBogotaDateString(new Date());
  const [year, month] = todayString.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    monthStart: `${year}-${pad(month)}-01`,
    monthEnd: `${year}-${pad(month)}-${pad(daysInMonth)}`,
  };
}

function buildRow(m: RosterEntry, completedDays: number, failedDays: number): LeaderboardRow {
  return {
    userId: m.userId,
    fullName: m.fullName,
    balance: m.balance,
    completedDays,
    failedDays,
    score: completedDays - failedDays,
  };
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
 * Ranks a group's members for the home-screen leaderboard using both
 * completed and failed days — score = completedDays - failedDays, highest
 * first (most attendance, fewest fails wins; ties broken by raw attendance,
 * then balance):
 * - 'week': live, in-progress week. completedDays comes from this week's
 *   check-ins plus any admin 'valid' override, minus any 'failed' override.
 *   failedDays is a live projection of GUARANTEED failures only — days still
 *   left in the week (today included) could still be completed, so nothing
 *   counts as failed until it's mathematically impossible to reach the
 *   (excused-adjusted) requirement anymore. On a Monday with 0 check-ins
 *   this is always 0, never "you've already failed the whole week."
 * - 'month': frozen weekly_evaluation_results for weeks that already ended
 *   this month, plus the same live week projection layered on top.
 * - 'all': every weekly_evaluation_result ever recorded, plus the live week.
 */
export function useLeaderboard(groupId: string | null) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [weekCompletedByUser, setWeekCompletedByUser] = useState<Record<string, number>>({});
  const [weekExcusedByUser, setWeekExcusedByUser] = useState<Record<string, number>>({});
  const [monthCompletedByUser, setMonthCompletedByUser] = useState<Record<string, number>>({});
  const [monthFailedByUser, setMonthFailedByUser] = useState<Record<string, number>>({});
  const [allCompletedByUser, setAllCompletedByUser] = useState<Record<string, number>>({});
  const [allFailedByUser, setAllFailedByUser] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRoster([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { weekStart, weekEnd } = getWeekBounds(new Date());
    const { monthStart } = currentMonthBounds();

    const [membersRes, checkinsRes, excusedRes, overridesRes, resultsRes] = await Promise.all([
      supabase
        .from('group_members')
        .select('user_id, balance, activated_at, joined_at, profile:profiles(full_name), group:groups(min_days_per_week)')
        .eq('group_id', groupId)
        .in('status', ['active', 'needs_recharge']),
      supabase
        .from('checkins')
        .select('user_id, checkin_date')
        .eq('group_id', groupId)
        .gte('checkin_date', weekStart)
        .lte('checkin_date', weekEnd),
      supabase
        .from('excuse_dates')
        .select('user_id, excused_date')
        .eq('group_id', groupId)
        .gte('excused_date', weekStart)
        .lte('excused_date', weekEnd),
      supabase
        .from('attendance_overrides')
        .select('user_id, override_date, status')
        .eq('group_id', groupId)
        .gte('override_date', weekStart)
        .lte('override_date', weekEnd),
      // All weekly_evaluation_results ever, with the run's week_start_date embedded —
      // used for both the "month" bucket (filtered client-side) and the "all" total.
      supabase
        .from('weekly_evaluation_results')
        .select('user_id, completed_days, failed_days, run:weekly_evaluation_runs(week_start_date)')
        .eq('group_id', groupId),
    ]);

    const members = (membersRes.data ?? []) as unknown as {
      user_id: string;
      balance: number;
      activated_at: string | null;
      joined_at: string;
      profile: { full_name: string } | null;
      group: { min_days_per_week: number } | null;
    }[];
    const rosterEntries = members.map((m) => ({
      userId: m.user_id,
      fullName: m.profile?.full_name ?? 'Miembro',
      balance: m.balance,
      minDaysPerWeek: m.group?.min_days_per_week ?? 0,
    }));
    setRoster(rosterEntries);

    // A check-in dated before the member's own activation date doesn't
    // count — same rule the dashboard's attendance view applies, and the
    // same reason it can drift out of sync with a check-in: the admin can
    // backdate activated_at (or mark a day 'failed') after the photo was
    // already taken, e.g. to retroactively invalidate early check-ins.
    const activatedDateByUserId = new Map<string, string | null>();
    for (const m of members) activatedDateByUserId.set(m.user_id, activatedDateOf(m));

    // This week's completed set = check-ins (on/after activation) ∪ 'valid'
    // overrides, minus 'failed' overrides (a failed override always wins,
    // even over a real check-in) — same rule run_weekly_evaluation applies.
    const checkinDatesByUser = new Map<string, Set<string>>();
    for (const c of checkinsRes.data ?? []) {
      const activatedDate = activatedDateByUserId.get(c.user_id);
      if (activatedDate && activatedDate > c.checkin_date) continue;
      if (!checkinDatesByUser.has(c.user_id)) checkinDatesByUser.set(c.user_id, new Set());
      checkinDatesByUser.get(c.user_id)!.add(c.checkin_date);
    }
    for (const o of overridesRes.data ?? []) {
      if (!checkinDatesByUser.has(o.user_id)) checkinDatesByUser.set(o.user_id, new Set());
      const set = checkinDatesByUser.get(o.user_id)!;
      if (o.status === 'valid') set.add(o.override_date);
      else set.delete(o.override_date);
    }
    const weekCompleted: Record<string, number> = {};
    for (const [userId, dates] of checkinDatesByUser) weekCompleted[userId] = dates.size;
    setWeekCompletedByUser(weekCompleted);

    const weekExcused: Record<string, number> = {};
    for (const e of excusedRes.data ?? []) {
      weekExcused[e.user_id] = (weekExcused[e.user_id] ?? 0) + 1;
    }
    setWeekExcusedByUser(weekExcused);

    const results = (resultsRes.data ?? []) as unknown as {
      user_id: string;
      completed_days: number;
      failed_days: number;
      run: { week_start_date: string } | null;
    }[];

    const monthCompleted: Record<string, number> = {};
    const monthFailed: Record<string, number> = {};
    const allCompleted: Record<string, number> = {};
    const allFailed: Record<string, number> = {};
    for (const r of results) {
      allCompleted[r.user_id] = (allCompleted[r.user_id] ?? 0) + r.completed_days;
      allFailed[r.user_id] = (allFailed[r.user_id] ?? 0) + r.failed_days;
      if (r.run && r.run.week_start_date >= monthStart) {
        monthCompleted[r.user_id] = (monthCompleted[r.user_id] ?? 0) + r.completed_days;
        monthFailed[r.user_id] = (monthFailed[r.user_id] ?? 0) + r.failed_days;
      }
    }
    setMonthCompletedByUser(monthCompleted);
    setMonthFailedByUser(monthFailed);
    setAllCompletedByUser(allCompleted);
    setAllFailedByUser(allFailed);

    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rowsByPeriod = useMemo(() => {
    const { weekEnd } = getWeekBounds(new Date());
    const todayString = toBogotaDateString(new Date());
    const remainingDays = daysRemainingInWeek(weekEnd, todayString);

    // Guaranteed-failures-only projection, reused by month/all too — see
    // the doc comment above for why this can't just be "required - completed".
    const liveFailed = (m: RosterEntry) => {
      const completed = weekCompletedByUser[m.userId] ?? 0;
      const excused = weekExcusedByUser[m.userId] ?? 0;
      const effectiveRequired = Math.max(m.minDaysPerWeek - excused, 0);
      const stillNeeded = Math.max(effectiveRequired - completed, 0);
      return Math.max(stillNeeded - remainingDays, 0);
    };

    const week = sortByScore(roster.map((m) => buildRow(m, weekCompletedByUser[m.userId] ?? 0, liveFailed(m))));

    const month = sortByScore(
      roster.map((m) =>
        buildRow(
          m,
          (monthCompletedByUser[m.userId] ?? 0) + (weekCompletedByUser[m.userId] ?? 0),
          (monthFailedByUser[m.userId] ?? 0) + liveFailed(m)
        )
      )
    );

    const all = sortByScore(
      roster.map((m) =>
        buildRow(
          m,
          (allCompletedByUser[m.userId] ?? 0) + (weekCompletedByUser[m.userId] ?? 0),
          (allFailedByUser[m.userId] ?? 0) + liveFailed(m)
        )
      )
    );

    return { week, month, all };
  }, [
    roster,
    weekCompletedByUser,
    weekExcusedByUser,
    monthCompletedByUser,
    monthFailedByUser,
    allCompletedByUser,
    allFailedByUser,
  ]);

  return { rowsByPeriod, isLoading, refresh };
}
