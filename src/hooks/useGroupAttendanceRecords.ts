import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { enumerateDates, toBogotaDateString } from '@/lib/domain/dateUtils';
import { classifyMemberDay, type DayAttendanceStatus } from '@/lib/domain/attendance';

export interface DayRecord {
  date: string;
  status: DayAttendanceStatus;
}

export interface MemberAttendanceRecord {
  userId: string;
  fullName: string;
  balance: number;
  minDaysPerWeek: number;
  /** Raw join timestamp, e.g. to compare against the group's own created_at for "founder" badges. */
  joinedAt: string;
  activatedDate: string | null;
  /**
   * One entry per day from this member's activation date through today,
   * classified with the exact same rule the Dashboard's attendance view
   * uses (see src/lib/domain/attendance.ts). Today can show as
   * 'completed'/'excused' but never as 'failed' until the day has passed.
   */
  days: DayRecord[];
}

function activatedDateOf(m: { activated_at: string | null; joined_at: string }): string | null {
  const activatedAt = m.activated_at ?? m.joined_at;
  return activatedAt ? toBogotaDateString(new Date(activatedAt)) : null;
}

/**
 * Fetches every group member's full day-by-day attendance history — the same
 * shape both the Ranking and the Dashboard already compute independently.
 * Shared here so a third caller (badges) can reuse it instead of copying the
 * fetch + classification loop a third time.
 */
export function useGroupAttendanceRecords(groupId: string | null) {
  const [records, setRecords] = useState<MemberAttendanceRecord[]>([]);
  const [groupCreatedDate, setGroupCreatedDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRecords([]);
      setGroupCreatedDate(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const todayString = toBogotaDateString(new Date());

    const [membersRes, checkinsRes, excusedRes, overridesRes] = await Promise.all([
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
    ]);

    const members = (membersRes.data ?? []) as unknown as {
      user_id: string;
      balance: number;
      activated_at: string | null;
      joined_at: string;
      profile: { full_name: string } | null;
      group: { min_days_per_week: number; created_at: string } | null;
    }[];

    const groupCreated = members[0]?.group?.created_at
      ? toBogotaDateString(new Date(members[0].group.created_at))
      : todayString;
    setGroupCreatedDate(groupCreated);

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
    const allDates = enumerateDates(groupCreated, todayString);

    const nextRecords: MemberAttendanceRecord[] = members.map((m) => {
      const activatedDate = activatedDateOf(m);
      const checkinDates = checkinDatesByUser.get(m.user_id);
      const validDates = validOverridesByUser.get(m.user_id);
      const failedDates = failedOverridesByUser.get(m.user_id);
      const excusedDates = excusedDatesByUser.get(m.user_id);
      const days: DayRecord[] = [];
      for (const date of allDates) {
        if (activatedDate && activatedDate > date) continue;
        const status = classifyMemberDay({
          hasCheckin: checkinDates?.has(date) ?? false,
          hasValidOverride: validDates?.has(date) ?? false,
          hasFailedOverride: failedDates?.has(date) ?? false,
          isExcused: excusedDates?.has(date) ?? false,
        });
        // Today isn't over yet — it can still show as completed/excused,
        // but never as failed until the day has actually passed.
        if (status === 'failed' && date === todayString) continue;
        days.push({ date, status });
      }
      return {
        userId: m.user_id,
        fullName: m.profile?.full_name ?? 'Miembro',
        balance: m.balance,
        minDaysPerWeek: m.group?.min_days_per_week ?? 0,
        joinedAt: m.joined_at,
        activatedDate,
        days,
      };
    });
    setRecords(nextRecords);

    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { records, groupCreatedDate, isLoading, refresh };
}
