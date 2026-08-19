import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { classifyMemberDay, gbScore, rankMembersByConsistency } from '@/lib/domain/attendance';
import type { CheckinReaction } from '@/lib/supabase/types';
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
  /** Wilson score lower bound (70% confidence) on completedCount/(completedCount+failedCount) — what members are actually ranked/sorted by here, not the raw ratio. See gbScore. */
  gbScore: number | null;
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
export function useGroupDayAttendance(groupId: string | null, rangeStart: string, rangeEnd: string, timezone: string) {
  const [days, setDays] = useState<DayAttendance[]>([]);
  const [members, setMembers] = useState<MemberAttendance[]>([]);
  const [checkinsByDate, setCheckinsByDate] = useState<Map<string, GroupCheckinWithProfile[]>>(new Map());
  const [excusedMembersByDate, setExcusedMembersByDate] = useState<Map<string, { user_id: string; full_name: string }[]>>(
    new Map()
  );
  const [reactionsByCheckinId, setReactionsByCheckinId] = useState<Map<string, CheckinReaction[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  // Separate from isLoading: only a manual pull-to-refresh gesture should
  // show the native RefreshControl spinner. isLoading alone still flips on
  // every period switch / tab refocus / mount, and wiring THAT to
  // `refreshing` made the list visibly dip down and spring back up every
  // time — the exact same class of bug already fixed for reactions below.
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(
    async (opts?: { manual?: boolean }) => {
      if (!groupId) {
        setDays([]);
        setMembers([]);
        setCheckinsByDate(new Map());
        setExcusedMembersByDate(new Map());
        setReactionsByCheckinId(new Map());
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }
      if (opts?.manual) setIsRefreshing(true);
      else setIsLoading(true);

    const [membersRes, checkinsRes, excusedRes, pendingVoteRes, overridesRes, reactionsRes] = await Promise.all([
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
      // Not yet approved, but already sent to the group's vote — the
      // calendar shows these too (see excusedMembersByDate below), separate
      // from excuse_dates/excusedByDate above, which stays approved-only
      // since THAT'S what drives dailyStatus/consistency/penalties and must
      // never count a request that could still be rejected.
      supabase
        .from('excuse_requests')
        .select('user_id, requested_start_date, requested_end_date')
        .eq('group_id', groupId)
        .eq('status', 'pending')
        .not('voting_closes_at', 'is', null)
        .lte('requested_start_date', rangeEnd)
        .gte('requested_end_date', rangeStart),
      supabase
        .from('attendance_overrides')
        .select('user_id, override_date, status')
        .eq('group_id', groupId)
        .gte('override_date', rangeStart)
        .lte('override_date', rangeEnd),
      supabase.from('checkin_reactions').select('*').eq('group_id', groupId),
    ]);

    const reactionsByCheckin = new Map<string, CheckinReaction[]>();
    for (const r of reactionsRes.data ?? []) {
      const list = reactionsByCheckin.get(r.checkin_id) ?? [];
      list.push(r);
      reactionsByCheckin.set(r.checkin_id, list);
    }
    setReactionsByCheckinId(reactionsByCheckin);

    const allMembersRaw = (membersRes.data ?? []) as unknown as {
      user_id: string;
      status: string;
      activated_at: string | null;
      joined_at: string;
      profile: { full_name: string };
    }[];
    const activeMembers = allMembersRaw.filter((m) => m.status === 'active' || m.status === 'needs_recharge');
    const checkins = (checkinsRes.data ?? []) as unknown as GroupCheckinWithProfile[];

    // Every member's activation date, regardless of current status — a
    // check-in dated before it doesn't count, even if the admin backdated
    // activated_at (or marked the day 'failed') *after* the photo was
    // already taken, e.g. to retroactively invalidate early check-ins.
    const activatedDateByUserId = new Map<string, string | null>();
    for (const m of allMembersRaw) {
      const activatedAt = m.activated_at ?? m.joined_at;
      activatedDateByUserId.set(m.user_id, activatedAt ? toZonedDateString(new Date(activatedAt), timezone) : null);
    }

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

    // Calendar-only view: approved excused days plus days still covered by a
    // request already in voting — unlike excusedByDate above, this never
    // feeds classifyMemberDay/consistency, purely a visual "heads up" signal.
    const fullNameByUserId = new Map(allMembersRaw.map((m) => [m.user_id, m.profile.full_name]));
    const nextExcusedMembersByDate = new Map<string, { user_id: string; full_name: string }[]>();
    const addExcusedMember = (date: string, userId: string) => {
      const fullName = fullNameByUserId.get(userId);
      if (!fullName) return;
      const list = nextExcusedMembersByDate.get(date) ?? [];
      if (!list.some((m) => m.user_id === userId)) list.push({ user_id: userId, full_name: fullName });
      nextExcusedMembersByDate.set(date, list);
    };
    for (const e of excusedRes.data ?? []) {
      addExcusedMember(e.excused_date, e.user_id);
    }
    for (const r of pendingVoteRes.data ?? []) {
      const start = r.requested_start_date < rangeStart ? rangeStart : r.requested_start_date;
      const end = r.requested_end_date > rangeEnd ? rangeEnd : r.requested_end_date;
      for (let d = start; d <= end; d = addOneDay(d)) {
        addExcusedMember(d, r.user_id);
      }
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

    const todayString = toZonedDateString(new Date(), timezone);
    const allDates: string[] = [];
    for (let cursor = rangeStart; cursor <= rangeEnd && cursor <= todayString; cursor = addOneDay(cursor)) {
      allDates.push(cursor);
    }

    const dayStats: DayAttendance[] = allDates.map((date) => {
      const activeMemberCount = activeMembers.filter((m) => {
        const activatedDate = activatedDateByUserId.get(m.user_id);
        return !activatedDate || activatedDate <= date;
      }).length;

      const completedUserIds = new Set(
        (byDate.get(date) ?? [])
          .filter((c) => {
            const activatedDate = activatedDateByUserId.get(c.user_id);
            return !activatedDate || activatedDate <= date;
          })
          .map((c) => c.user_id)
      );
      const dayOverrides = overridesByDate.get(date);
      if (dayOverrides) {
        for (const uid of dayOverrides.valid) completedUserIds.add(uid);
        for (const uid of dayOverrides.failed) completedUserIds.delete(uid);
      }
      const completedCount = completedUserIds.size;
      const excusedCount = [...(excusedByDate.get(date) ?? [])].filter((uid) => {
        const activatedDate = activatedDateByUserId.get(uid);
        return !activatedDate || activatedDate <= date;
      }).length;
      // Today isn't over yet — anyone who hasn't checked in still can, so
      // nobody can be counted as "failed" until the day has actually passed.
      const notTrainedCount =
        date === todayString ? 0 : Math.max(activeMemberCount - completedCount - excusedCount, 0);

      return { date, activeMemberCount, completedCount, excusedCount, notTrainedCount };
    });

    dayStats.sort((a, b) => (a.date < b.date ? 1 : -1)); // most recent first

    const memberStats: MemberAttendance[] = activeMembers.map((m) => {
      const activatedDate = activatedDateByUserId.get(m.user_id) ?? null;
      let completedCount = 0;
      let excusedCount = 0;
      let failedCount = 0;
      let activeDaysCount = 0;
      const dailyStatus: Record<string, 'completed' | 'excused' | 'failed'> = {};

      for (const date of allDates) {
        if (activatedDate && activatedDate > date) continue;
        activeDaysCount++;

        const dayOverrides = overridesByDate.get(date);
        const status = classifyMemberDay({
          hasCheckin: (byDate.get(date) ?? []).some((c) => c.user_id === m.user_id),
          hasValidOverride: dayOverrides?.valid.has(m.user_id) ?? false,
          hasFailedOverride: dayOverrides?.failed.has(m.user_id) ?? false,
          isExcused: excusedByDate.get(date)?.has(m.user_id) ?? false,
        });

        // Today isn't over yet — anyone who hasn't checked in still can, so
        // it never counts as "failed" until the day has actually passed
        // (but it can still show as completed/excused today, same as before).
        if (status === 'failed' && date === todayString) continue;

        dailyStatus[date] = status;
        if (status === 'completed') completedCount++;
        else if (status === 'excused') excusedCount++;
        else failedCount++;
      }

      return {
        user_id: m.user_id,
        full_name: m.profile.full_name,
        completedCount,
        excusedCount,
        failedCount,
        activeDaysCount,
        dailyStatus,
        gbScore: gbScore(completedCount, failedCount),
      };
    });

    // Ranked by GB Score alone (never balance/money, never workout duration).
    const rankByUserId = rankMembersByConsistency(
      memberStats.map((m) => ({ userId: m.user_id, completedCount: m.completedCount, failedCount: m.failedCount }))
    );
    memberStats.sort(
      (a, b) => rankByUserId.get(a.user_id)! - rankByUserId.get(b.user_id)! || a.full_name.localeCompare(b.full_name)
    );

    // What every consumer (Día por día, Calendario) should treat as "this
    // person actually trained that day" — excludes a check-in that's been
    // overridden to 'failed' (e.g. a photo challenge or admin correction) or
    // that landed before the member's activation date, same rule the
    // per-member dailyStatus above already applies.
    const visibleByDate = new Map<string, GroupCheckinWithProfile[]>();
    for (const [date, list] of byDate) {
      const visible = list.filter((c) => {
        if (overridesByDate.get(date)?.failed.has(c.user_id)) return false;
        const activatedDate = activatedDateByUserId.get(c.user_id);
        return !activatedDate || activatedDate <= date;
      });
      if (visible.length > 0) visibleByDate.set(date, visible);
    }

    setDays(dayStats);
    setMembers(memberStats);
    setCheckinsByDate(visibleByDate);
    setExcusedMembersByDate(nextExcusedMembersByDate);
    setIsLoading(false);
    setIsRefreshing(false);
    },
    [groupId, rangeStart, rangeEnd, timezone]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Deliberately doesn't touch isLoading — that flag drives the screen's
  // pull-to-refresh spinner, and reacting shouldn't visually shift the
  // whole list down every time someone taps an emoji.
  const refreshReactions = useCallback(async () => {
    if (!groupId) return;
    const { data } = await supabase.from('checkin_reactions').select('*').eq('group_id', groupId);
    const reactionsByCheckin = new Map<string, CheckinReaction[]>();
    for (const r of data ?? []) {
      const list = reactionsByCheckin.get(r.checkin_id) ?? [];
      list.push(r);
      reactionsByCheckin.set(r.checkin_id, list);
    }
    setReactionsByCheckinId(reactionsByCheckin);
  }, [groupId]);

  const react = useCallback(
    async (checkinId: string, emoji: string) => {
      const { error } = await supabase.rpc('react_to_checkin', { p_checkin_id: checkinId, p_emoji: emoji });
      if (error) throw new Error(error.message);
      await refreshReactions();
    },
    [refreshReactions]
  );

  const removeReaction = useCallback(
    async (checkinId: string) => {
      const { error } = await supabase.rpc('remove_reaction', { p_checkin_id: checkinId });
      if (error) throw new Error(error.message);
      await refreshReactions();
    },
    [refreshReactions]
  );

  return {
    days,
    members,
    checkinsByDate,
    excusedMembersByDate,
    reactionsByCheckinId,
    isLoading,
    isRefreshing,
    refresh,
    react,
    removeReaction,
  };
}
