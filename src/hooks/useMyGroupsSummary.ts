import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMyMemberships, type MembershipWithGroup } from '@/hooks/useMyMemberships';
import { fetchGroupAttendanceRecords } from '@/hooks/useGroupAttendanceRecords';
import { fetchLeaguePayoutPreview } from '@/hooks/useLeaguePayoutPreview';
import { fetchGroupMonthlyChallenges } from '@/hooks/useGroupMonthlyChallenges';
import { fetchGroupBadges } from '@/hooks/useGroupBadges';
import { consistencyPercent, gbScore, rankMembersByConsistency, tallyAttendance } from '@/lib/domain/attendance';
import { getWeekBounds, toZonedDateString } from '@/lib/domain/dateUtils';
import type { LevelProgress } from '@/lib/domain/xp';

// This screen ("Tus grupos") predates, and is out of scope for, the
// Ciclo/Total split added to useLeaderboard's own LeaderboardPeriod — it
// keeps its original 3-period Semana/Mes/Acumulado view for every group
// regardless of payout mode, so it uses its own narrower type instead of
// reusing that one.
export type SummaryPeriod = 'week' | 'month' | 'total';

export interface GroupPeriodStat {
  completedDays: number;
  failedDays: number;
  consistencyPercent: number | null;
  gbScore: number | null;
  activeMemberCount: number;
}

export interface MyGroupSummary {
  membership: MembershipWithGroup;
  /** null only for a pending_deposit membership — there's no attendance to rank yet. */
  statsByPeriod: Record<SummaryPeriod, GroupPeriodStat> | null;
  /**
   * The member's ONE standing in this group — deliberately independent of
   * whichever period tab (Semana/Mes/Acumulado) is selected, unlike the
   * completed/failed/consistency/GB numbers in statsByPeriod above, which
   * are meant to vary by period. Switching tabs must never change this
   * number: it's "how positions are actually decided in this group", not a
   * period-scoped snapshot.
   *
   * League/Mixto: the real cycle place, same source as the money shown on
   * Inicio (liquidate_group_now) — falls back to the all-time GB Score rank
   * only while there's no ranking signal yet (cycle just started, nobody's
   * checked in since). Cooperativo: always the all-time GB Score rank, since
   * there's no cycle to anchor to. Null only with no attendance data at all.
   */
  position: { rank: number; of: number } | null;
  /**
   * League mode only, from the exact same source as `position` above
   * (liquidate_group_now) — kept as its own field because the UI shows it
   * as a separate "Liga: puesto X · $Y" line alongside the generic
   * "Posición #X" one. Null for Cooperativo/Mixto, or while there's no
   * ranking signal yet.
   */
  leaguePlace: number | null;
  leagueAmount: number | null;
  /** Same level ring shown on Perfil (lifetime badge + monthly challenge + KOTH XP) — null only for a pending_deposit membership. */
  level: LevelProgress | null;
}

async function computeGroupSummary(membership: MembershipWithGroup, userId: string): Promise<MyGroupSummary> {
  const group = membership.group;

  if (membership.status === 'pending_deposit') {
    return { membership, statsByPeriod: null, position: null, leaguePlace: null, leagueAmount: null, level: null };
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
    const mine = perMember.find((m) => m.userId === userId);
    return {
      completedDays: mine?.completedCount ?? 0,
      failedDays: mine?.failedCount ?? 0,
      consistencyPercent: mine ? consistencyPercent(mine.completedCount, mine.failedCount) : null,
      gbScore: mine ? gbScore(mine.completedCount, mine.failedCount) : null,
      activeMemberCount: perMember.length,
    };
  };

  // position: see the doc comment on MyGroupSummary.position — always
  // all-time attendance, never a period tab, with League/Mixto's real cycle
  // place taking over once there's a ranking signal for it.
  const allTimePerMember = records.map((m) => {
    const tally = tallyAttendance(m.days.map((d) => d.status));
    return { userId: m.userId, completedCount: tally.completedCount, failedCount: tally.failedCount };
  });
  const allTimeRankByUserId = rankMembersByConsistency(allTimePerMember);
  const cyclePlace = leaguePreview.placeByUserId[userId] ?? null;
  const position =
    cyclePlace !== null
      ? { rank: cyclePlace, of: allTimePerMember.length }
      : allTimeRankByUserId.has(userId)
        ? { rank: allTimeRankByUserId.get(userId)!, of: allTimePerMember.length }
        : null;

  return {
    membership,
    statsByPeriod: {
      week: buildStat(weekStart, weekEnd),
      month: buildStat(monthStart, todayString),
      total: buildStat('0001-01-01', todayString),
    },
    position,
    leaguePlace: group.payout_mode === 'league' ? cyclePlace : null,
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
