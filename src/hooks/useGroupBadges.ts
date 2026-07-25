import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toBogotaDateString, toBogotaHour } from '@/lib/domain/dateUtils';
import { useGroupAttendanceRecords } from '@/hooks/useGroupAttendanceRecords';
import { BADGES, type BadgeContext, type BadgeStatus } from '@/lib/domain/badges';
import { levelProgress, totalXpForEarnedBadges, type LevelProgress } from '@/lib/domain/xp';
import { useGroupMonthlyChallenges } from '@/hooks/useGroupMonthlyChallenges';
import type { MonthlyChallengeStatus } from '@/lib/domain/monthlyChallenges';

export interface MemberBadges {
  userId: string;
  fullName: string;
  statuses: Record<string, BadgeStatus>;
  earnedCount: number;
  monthlyStatuses: Record<string, MonthlyChallengeStatus>;
  /** Level combines lifetime badge XP and monthly challenge XP (see xp.ts) — always the single source of truth for a member's level everywhere it's shown. */
  level: LevelProgress;
}

/**
 * Evaluates the full badge catalog (src/lib/domain/badges.ts) for every
 * active member of a group. Badges are computed live from existing data —
 * there is no badges table — so a member who already qualifies today shows
 * as earned immediately, with no backfill step needed.
 */
export function useGroupBadges(groupId: string | null) {
  const {
    records,
    groupCreatedDate,
    isLoading: recordsLoading,
    refresh: refreshRecords,
  } = useGroupAttendanceRecords(groupId);
  const {
    membersChallenges,
    isLoading: monthlyLoading,
    refresh: refreshMonthly,
  } = useGroupMonthlyChallenges(groupId);
  const [checkinsByUser, setCheckinsByUser] = useState<
    Map<string, { date: string; hourBogota: number; workoutMinutes: number | null }[]>
  >(new Map());
  const [weeklyPenaltiesByUser, setWeeklyPenaltiesByUser] = useState<Map<string, { weekStartDate: string; penaltyCharged: number }[]>>(
    new Map()
  );
  const [initialDepositUsers, setInitialDepositUsers] = useState<Set<string>>(new Set());
  const [reactionsGivenDatesByUser, setReactionsGivenDatesByUser] = useState<Map<string, string[]>>(new Map());
  const [reactionsGivenByRecipientByUser, setReactionsGivenByRecipientByUser] = useState<Map<string, Record<string, number>>>(new Map());
  const [reactionsReceivedByUser, setReactionsReceivedByUser] = useState<Map<string, number>>(new Map());
  const [ruleProposalsWonByUser, setRuleProposalsWonByUser] = useState<Map<string, number>>(new Map());
  const [extrasLoading, setExtrasLoading] = useState(true);

  const refreshExtras = useCallback(async () => {
    if (!groupId) {
      setCheckinsByUser(new Map());
      setWeeklyPenaltiesByUser(new Map());
      setInitialDepositUsers(new Set());
      setReactionsGivenDatesByUser(new Map());
      setReactionsGivenByRecipientByUser(new Map());
      setReactionsReceivedByUser(new Map());
      setRuleProposalsWonByUser(new Map());
      setExtrasLoading(false);
      return;
    }
    setExtrasLoading(true);
    const todayString = toBogotaDateString(new Date());

    const [checkinsRes, resultsRes, depositsRes, reactionsRes, proposalsRes] = await Promise.all([
      supabase
        .from('checkins')
        .select('user_id, checkin_date, captured_at, workout_minutes')
        .eq('group_id', groupId)
        .lte('checkin_date', todayString),
      supabase
        .from('weekly_evaluation_results')
        .select('user_id, penalty_charged, run:weekly_evaluation_runs(week_start_date)')
        .eq('group_id', groupId),
      supabase.from('wallet_transactions').select('user_id').eq('group_id', groupId).eq('type', 'initial_deposit'),
      supabase
        .from('checkin_reactions')
        .select('user_id, created_at, checkin:checkins(user_id)')
        .eq('group_id', groupId),
      supabase
        .from('rule_proposals')
        .select('proposed_by, status')
        .eq('group_id', groupId)
        .in('status', ['approved', 'applied']),
    ]);

    const nextCheckins = new Map<string, { date: string; hourBogota: number; workoutMinutes: number | null }[]>();
    for (const c of checkinsRes.data ?? []) {
      if (!nextCheckins.has(c.user_id)) nextCheckins.set(c.user_id, []);
      nextCheckins
        .get(c.user_id)!
        .push({ date: c.checkin_date, hourBogota: toBogotaHour(new Date(c.captured_at)), workoutMinutes: c.workout_minutes });
    }
    setCheckinsByUser(nextCheckins);

    const results = (resultsRes.data ?? []) as unknown as {
      user_id: string;
      penalty_charged: number;
      run: { week_start_date: string } | null;
    }[];
    const nextPenalties = new Map<string, { weekStartDate: string; penaltyCharged: number }[]>();
    for (const r of results) {
      if (!r.run) continue;
      if (!nextPenalties.has(r.user_id)) nextPenalties.set(r.user_id, []);
      nextPenalties.get(r.user_id)!.push({ weekStartDate: r.run.week_start_date, penaltyCharged: r.penalty_charged });
    }
    setWeeklyPenaltiesByUser(nextPenalties);

    setInitialDepositUsers(new Set((depositsRes.data ?? []).map((d) => d.user_id)));

    const reactions = (reactionsRes.data ?? []) as unknown as {
      user_id: string;
      created_at: string;
      checkin: { user_id: string } | null;
    }[];
    const nextReactionDates = new Map<string, string[]>();
    const nextReactionsByRecipient = new Map<string, Record<string, number>>();
    const nextReactionsReceived = new Map<string, number>();
    for (const r of reactions) {
      if (!nextReactionDates.has(r.user_id)) nextReactionDates.set(r.user_id, []);
      nextReactionDates.get(r.user_id)!.push(toBogotaDateString(new Date(r.created_at)));

      if (r.checkin) {
        if (!nextReactionsByRecipient.has(r.user_id)) nextReactionsByRecipient.set(r.user_id, {});
        const byRecipient = nextReactionsByRecipient.get(r.user_id)!;
        byRecipient[r.checkin.user_id] = (byRecipient[r.checkin.user_id] ?? 0) + 1;

        nextReactionsReceived.set(r.checkin.user_id, (nextReactionsReceived.get(r.checkin.user_id) ?? 0) + 1);
      }
    }
    setReactionsGivenDatesByUser(nextReactionDates);
    setReactionsGivenByRecipientByUser(nextReactionsByRecipient);
    setReactionsReceivedByUser(nextReactionsReceived);

    const nextProposalsWon = new Map<string, number>();
    for (const p of proposalsRes.data ?? []) {
      nextProposalsWon.set(p.proposed_by, (nextProposalsWon.get(p.proposed_by) ?? 0) + 1);
    }
    setRuleProposalsWonByUser(nextProposalsWon);

    setExtrasLoading(false);
  }, [groupId]);

  useEffect(() => {
    refreshExtras();
  }, [refreshExtras]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshRecords(), refreshExtras(), refreshMonthly()]);
  }, [refreshRecords, refreshExtras, refreshMonthly]);

  const monthlyByUserId = useMemo(
    () => new Map(membersChallenges.map((m) => [m.userId, m])),
    [membersChallenges]
  );

  const membersBadges = useMemo<MemberBadges[]>(() => {
    const todayString = toBogotaDateString(new Date());
    return records.map((m) => {
      const ctx: BadgeContext = {
        todayString,
        groupCreatedDate: groupCreatedDate ?? todayString,
        joinedDate: toBogotaDateString(new Date(m.joinedAt)),
        days: m.days,
        checkins: checkinsByUser.get(m.userId) ?? [],
        weeklyPenalties: weeklyPenaltiesByUser.get(m.userId) ?? [],
        hasInitialDeposit: initialDepositUsers.has(m.userId),
        reactionsGivenDates: reactionsGivenDatesByUser.get(m.userId) ?? [],
        reactionsGivenByRecipient: reactionsGivenByRecipientByUser.get(m.userId) ?? {},
        reactionsReceivedCount: reactionsReceivedByUser.get(m.userId) ?? 0,
        ruleProposalsWonCount: ruleProposalsWonByUser.get(m.userId) ?? 0,
      };
      const statuses: Record<string, BadgeStatus> = {};
      const earnedBadgeIds: string[] = [];
      for (const b of BADGES) {
        const status = b.evaluate(ctx);
        statuses[b.id] = status;
        if (status.earned) earnedBadgeIds.push(b.id);
      }
      const monthly = monthlyByUserId.get(m.userId);
      const lifetimeXp = totalXpForEarnedBadges(earnedBadgeIds);
      return {
        userId: m.userId,
        fullName: m.fullName,
        statuses,
        earnedCount: earnedBadgeIds.length,
        monthlyStatuses: monthly?.statusesById ?? {},
        level: levelProgress(lifetimeXp + (monthly?.totalXp ?? 0)),
      };
    });
  }, [
    records,
    groupCreatedDate,
    checkinsByUser,
    weeklyPenaltiesByUser,
    initialDepositUsers,
    reactionsGivenDatesByUser,
    reactionsGivenByRecipientByUser,
    reactionsReceivedByUser,
    ruleProposalsWonByUser,
    monthlyByUserId,
  ]);

  return {
    membersBadges,
    isLoading: recordsLoading || extrasLoading || monthlyLoading,
    refresh,
  };
}
