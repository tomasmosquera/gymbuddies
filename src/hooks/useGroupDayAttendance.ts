import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toBogotaDateString } from '@/lib/domain/dateUtils';
import type { GroupCheckinWithProfile } from './useGroupWeekCheckins';

export interface DayAttendance {
  date: string;
  activeMemberCount: number;
  completedCount: number;
  excusedCount: number;
  notTrainedCount: number;
}

export interface MemberAttendance {
  user_id: string;
  full_name: string;
  completedCount: number;
  excusedCount: number;
  failedCount: number;
  activeDaysCount: number;
  dailyStatus: Record<string, 'completed' | 'excused' | 'failed'>;
}

function addOneDay(dateString: string): string {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Group attendance for the range [rangeStart, rangeEnd] (clamped to not go
 * past today), pivoted two ways from the same fetch: day-by-day (how many
 * active members trained/were excused/didn't show up each day) and
 * member-by-member (how each individual member did across the whole range)
 * — plus the raw check-ins (with profiles) per day for the photo/location/
 * duration drill-down.
 */
export function useGroupDayAttendance(groupId: string | null, rangeStart: string, rangeEnd: string) {
  const [days, setDays] = useState<DayAttendance[]>([]);
  const [members, setMembers] = useState<MemberAttendance[]>([]);
  const [checkinsByDate, setCheckinsByDate] = useState<Map<string, GroupCheckinWithProfile[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setDays([]);
      setMembers([]);
      setCheckinsByDate(new Map());
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    const [membersRes, checkinsRes, excusedRes, overridesRes] = await Promise.all([
      supabase
        .from('group_members')
        .select('user_id, status, activated_at, joined_at, profile:profiles(full_name)')
        .eq('group_id', groupId),
      supabase
        .from('checkins')
        .select('*, profile:profiles(full_name)')
        .eq('group_id', groupId)
        .gte('checkin_date', rangeStart)
        .lte('checkin_date', rangeEnd),
      supabase
        .from('excuse_dates')
        .select('user_id, excused_date')
        .eq('group_id', groupId)
        .gte('excused_date', rangeStart)
        .lte('excused_date', rangeEnd),
      supabase
        .from('attendance_overrides')
        .select('user_id, override_date, status')
        .eq('group_id', groupId)
        .gte('override_date', rangeStart)
        .lte('override_date', rangeEnd),
    ]);

    const activeMembers = (membersRes.data ?? []).filter(
      (m) => m.status === 'active' || m.status === 'needs_recharge'
    ) as unknown as {
      user_id: string;
      activated_at: string | null;
      joined_at: string;
      profile: { full_name: string };
    }[];
    const checkins = (checkinsRes.data ?? []) as unknown as GroupCheckinWithProfile[];

    const byDate = new Map<string, GroupCheckinWithProfile[]>();
    for (const c of checkins) {
      const list = byDate.get(c.checkin_date) ?? [];
      list.push(c);
      byDate.set(c.checkin_date, list);
    }

    const excusedByDate = new Map<string, Set<string>>();
    for (const e of excusedRes.data ?? []) {
      if (!excusedByDate.has(e.excused_date)) excusedByDate.set(e.excused_date, new Set());
      excusedByDate.get(e.excused_date)!.add(e.user_id);
    }

    const overridesByDate = new Map<string, { valid: Set<string>; failed: Set<string> }>();
    for (const o of overridesRes.data ?? []) {
      if (!overridesByDate.has(o.override_date)) {
        overridesByDate.set(o.override_date, { valid: new Set(), failed: new Set() });
      }
      const entry = overridesByDate.get(o.override_date)!;
      if (o.status === 'valid') entry.valid.add(o.user_id);
      else entry.failed.add(o.user_id);
    }

    const todayString = toBogotaDateString(new Date());
    const allDates: string[] = [];
    for (let cursor = rangeStart; cursor <= rangeEnd && cursor <= todayString; cursor = addOneDay(cursor)) {
      allDates.push(cursor);
    }

    const activatedDateOf = (m: { activated_at: string | null; joined_at: string }): string | null => {
      const activatedAt = m.activated_at ?? m.joined_at;
      return activatedAt ? toBogotaDateString(new Date(activatedAt)) : null;
    };

    const dayStats: DayAttendance[] = allDates.map((date) => {
      const activeMemberCount = activeMembers.filter((m) => {
        const activatedDate = activatedDateOf(m);
        return !activatedDate || activatedDate <= date;
      }).length;

      const completedUserIds = new Set((byDate.get(date) ?? []).map((c) => c.user_id));
      const dayOverrides = overridesByDate.get(date);
      if (dayOverrides) {
        for (const uid of dayOverrides.valid) completedUserIds.add(uid);
        for (const uid of dayOverrides.failed) completedUserIds.delete(uid);
      }
      const completedCount = completedUserIds.size;
      const excusedCount = excusedByDate.get(date)?.size ?? 0;
      // Today isn't over yet — anyone who hasn't checked in still can, so
      // nobody can be counted as "failed" until the day has actually passed.
      const notTrainedCount =
        date === todayString ? 0 : Math.max(activeMemberCount - completedCount - excusedCount, 0);

      return { date, activeMemberCount, completedCount, excusedCount, notTrainedCount };
    });

    dayStats.sort((a, b) => (a.date < b.date ? 1 : -1)); // most recent first

    const memberStats: MemberAttendance[] = activeMembers.map((m) => {
      const activatedDate = activatedDateOf(m);
      let completedCount = 0;
      let excusedCount = 0;
      let failedCount = 0;
      let activeDaysCount = 0;
      const dailyStatus: Record<string, 'completed' | 'excused' | 'failed'> = {};

      for (const date of allDates) {
        if (activatedDate && activatedDate > date) continue;
        activeDaysCount++;

        const dayOverrides = overridesByDate.get(date);
        const hasFailedOverride = dayOverrides?.failed.has(m.user_id) ?? false;
        const hasValidOverride = dayOverrides?.valid.has(m.user_id) ?? false;
        const hasCheckin = (byDate.get(date) ?? []).some((c) => c.user_id === m.user_id);
        const isCompleted = (hasCheckin || hasValidOverride) && !hasFailedOverride;
        const isExcused = excusedByDate.get(date)?.has(m.user_id) ?? false;

        if (isCompleted) {
          completedCount++;
          dailyStatus[date] = 'completed';
        } else if (isExcused) {
          excusedCount++;
          dailyStatus[date] = 'excused';
        } else if (date !== todayString) {
          failedCount++;
          dailyStatus[date] = 'failed';
        }
      }

      return {
        user_id: m.user_id,
        full_name: m.profile.full_name,
        completedCount,
        excusedCount,
        failedCount,
        activeDaysCount,
        dailyStatus,
      };
    });

    memberStats.sort((a, b) => b.completedCount - a.completedCount);

    setDays(dayStats);
    setMembers(memberStats);
    setCheckinsByDate(byDate);
    setIsLoading(false);
  }, [groupId, rangeStart, rangeEnd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { days, members, checkinsByDate, isLoading, refresh };
}
