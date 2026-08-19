import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMyMemberships, type MembershipWithGroup } from '@/hooks/useMyMemberships';
import { fetchGroupAttendanceRecords } from '@/hooks/useGroupAttendanceRecords';
import { fetchLeaguePayoutPreview } from '@/hooks/useLeaguePayoutPreview';
import { fetchGroupMonthlyChallenges } from '@/hooks/useGroupMonthlyChallenges';
import { fetchGroupBadges } from '@/hooks/useGroupBadges';
import { consistencyPercent, gbScore, rankMembersByConsistency, tallyAttendance } from '@/lib/domain/attendance';
import { getWeekBounds, toZonedDateString } from '@/lib/domain/dateUtils';
import type { LeaderboardPeriod } from '@/hooks/useLeaderboard';
import type { LevelProgress } from '@/lib/domain/xp';

export interface GroupPeriodStat {
  completedDays: number;
  failedDays: number;
  consistencyPercent: number | null;
  gbScore: number | null;
  /** 1-based, ties share a rank — null with no decided days yet this period. */
  rank: number | null;
  activeMemberCount: number;
}

export interface MyGroupSummary {
  membership: MembershipWithGroup;
  /** null only for a pending_deposit membership — there's no attendance to rank yet. */
  statsByPeriod: Record<LeaderboardPeriod, GroupPeriodStat> | null;
  /**
   * League mode only, from the exact same source as the money shown on
   * Inicio (liquidate_group_now) — same value regardless of which period
   * tab is selected, since it reflects the whole cycle, not a period-scoped
   * total. Null for Cooperativo/Mixto, or while there's no ranking signal
   * yet (cycle just started, nobody's checked in since).
   */
  leaguePlace: number | null;
  leagueAmount: number | null;
  /** Same level ring shown on Perfil (lifetime badge + monthly challenge + KOTH XP) — null only for a pending_deposit membership. */
  level: LevelProgress | null;
}

async function computeGroupSummary(membership: MembershipWithGroup, userId: string): Promise<MyGroupSummary> {
  const group = membership.group;

  if (membership.status === 'pending_deposit') {
    return { membership, statsByPeriod: null, leaguePlace: null, leagueAmount: null, level: null };
  }

  const timezone = group.timezone;
  const todayString = toZonedDateString(new Date(), timezone);
  const { weekStart, weekEnd } = getWeekBounds(new Date(), timezone);
  const monthStart = `${todayString.slice(0, 7)}-01`;

  const [{ records, groupCreatedDate }, leaguePreview] = await Promise.all([
    fetchGroupAttendanceRecords(group.id, timezone),
    fetchLeaguePayoutPreview(group.id, group.payout_mode),
  ]);

  const membersChallenges = await fetchGroupMonthlyChallenges(group.id, timezone, records, groupCreatedDate);
  const membersBadges = await fetchGroupBadges(group.id, timezone, records, groupCreatedDate, membersChallenges);
  const myLevel = membersBadges.find((b) => b.userId === userId)?.level ?? null;

  const buildStat = (rangeStart: string, rangeEnd: string): GroupPeriodStat => {
    const perMember = records.map((m) => {
      const statuses = m.days.filter((d) => d.date >= rangeStart && d.date <= rangeEnd).map((d) => d.status);
      const tally = tallyAttendance(statuses);
      return { userId: m.userId, completedCount: tally.completedCount, failedCount: tally.failedCount };
    });
    const rankByUserId = rankMembersByConsistency(perMember);
    const mine = perMember.find((m) => m.userId === userId);
    return {
      completedDays: mine?.completedCount ?? 0,
      failedDays: mine?.failedCount ?? 0,
      consistencyPercent: mine ? consistencyPercent(mine.completedCount, mine.failedCount) : null,
      gbScore: mine ? gbScore(mine.completedCount, mine.failedCount) : null,
      rank: mine ? (rankByUserId.get(userId) ?? null) : null,
      activeMemberCount: perMember.length,
    };
  };

  return {
    membership,
    statsByPeriod: {
      week: buildStat(weekStart, weekEnd),
      month: buildStat(monthStart, todayString),
      all: buildStat('0001-01-01', todayString),
    },
    leaguePlace: group.payout_mode === 'league' ? (leaguePreview.placeByUserId[userId] ?? null) : null,
    leagueAmount: group.payout_mode === 'league' ? (leaguePreview.amountByUserId[userId] ?? 0) : null,
    level: myLevel,
  };
}

/**
 * Every group the signed-in member belongs to, each with its own
 * week/month/all-time standing (position, consistency, GB Score) — the data
 * behind "Tus grupos" (tap the group name on Inicio). One computeGroupSummary
 * call per membership, run in parallel — each is its own independent fetch
 * (mirrors what Inicio's own Ranking does for a single group), so this is
 * genuinely N× the work of Inicio, not a cheap query; fine for the handful
 * of groups a member is realistically ever in.
 */
export function useMyGroupsSummary() {
  const { session } = useAuth();
  const { memberships, isLoading: membershipsLoading, refresh: refreshMemberships } = useMyMemberships();
  const [summaries, setSummaries] = useState<MyGroupSummary[]>([]);
  const [isComputing, setIsComputing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!session || membershipsLoading) return;
    setIsComputing(true);
    Promise.all(memberships.map((m) => computeGroupSummary(m, session.user.id))).then((results) => {
      if (!cancelled) {
        setSummaries(results);
        setIsComputing(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session, memberships, membershipsLoading]);

  const refresh = useCallback(async () => {
    await refreshMemberships();
  }, [refreshMemberships]);

  return { summaries, isLoading: membershipsLoading || isComputing, refresh };
}
