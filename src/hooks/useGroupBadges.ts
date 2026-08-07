import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString, toZonedHour } from '@/lib/domain/dateUtils';
import { useGroupAttendanceRecords } from '@/hooks/useGroupAttendanceRecords';
import { BADGES, type BadgeContext, type BadgeStatus } from '@/lib/domain/badges';
import { levelProgress, totalXpForEarnedBadges, type LevelProgress } from '@/lib/domain/xp';
import { isKothGroupFounder, kothReclaimedThroneCount, type KothClaimFact } from '@/lib/domain/koth';
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
export function useGroupBadges(groupId: string | null, timezone: string) {
  const {
    records,
    groupCreatedDate,
    isLoading: recordsLoading,
    refresh: refreshRecords,
  } = useGroupAttendanceRecords(groupId, timezone);
  const {
    membersChallenges,
    isLoading: monthlyLoading,
    refresh: refreshMonthly,
  } = useGroupMonthlyChallenges(groupId, timezone);
  const [checkinsByUser, setCheckinsByUser] = useState<
    Map<string, { date: string; hourBogota: number; workoutMinutes: number | null }[]>
  >(new Map());
  const [weeklyPenaltiesByUser, setWeeklyPenaltiesByUser] = useState<Map<string, { weekStartDate: string; penaltyCharged: number }[]>>(
    new Map()
  );
  const [fundedWalletUsers, setFundedWalletUsers] = useState<Set<string>>(new Set());
  // Raw rows (not pre-aggregated) so each member's own activation date can
  // filter out practice/pre-membership reactions before tallying — see the
  // membersBadges useMemo below, which does the actual give/receive counting.
  const [rawReactions, setRawReactions] = useState<{ giverId: string; recipientId: string; date: string }[]>([]);
  const [ruleProposalsWonByUser, setRuleProposalsWonByUser] = useState<Map<string, number>>(new Map());
  const [kothClaims, setKothClaims] = useState<KothClaimFact[]>([]);
  const [kothCurrentlyHeldExerciseIdsByUser, setKothCurrentlyHeldExerciseIdsByUser] = useState<Map<string, string[]>>(
    new Map()
  );
  const [extrasLoading, setExtrasLoading] = useState(true);

  const refreshExtras = useCallback(async () => {
    if (!groupId) {
      setCheckinsByUser(new Map());
      setWeeklyPenaltiesByUser(new Map());
      setFundedWalletUsers(new Set());
      setRawReactions([]);
      setRuleProposalsWonByUser(new Map());
      setKothClaims([]);
      setKothCurrentlyHeldExerciseIdsByUser(new Map());
      setExtrasLoading(false);
      return;
    }
    setExtrasLoading(true);
    const todayString = toZonedDateString(new Date(), timezone);

    const [checkinsRes, resultsRes, depositsRes, reactionsRes, proposalsRes, kothClaimsRes, kothRecordsRes] = await Promise.all([
      supabase
        .from('checkins')
        .select('user_id, checkin_date, captured_at, workout_minutes')
        .eq('group_id', groupId)
        .lte('checkin_date', todayString),
      supabase
        .from('weekly_evaluation_results')
        .select('user_id, penalty_charged, run:weekly_evaluation_runs(week_start_date)')
        .eq('group_id', groupId),
      supabase
        .from('wallet_transactions')
        .select('user_id')
        .eq('group_id', groupId)
        .in('type', ['initial_deposit', 'recharge'])
        .eq('status', 'confirmed'),
      supabase
        .from('checkin_reactions')
        .select('user_id, created_at, checkin:checkins(user_id)')
        .eq('group_id', groupId),
      supabase
        .from('rule_proposals')
        .select('proposed_by, status')
        .eq('group_id', groupId)
        .in('status', ['approved', 'applied']),
      // counts_for_record excludes practice claims made during a member's
      // protection period — see 0084_koth_respects_protection.sql. Those
      // never crowned anyone, so they must not count as "ever champion" for
      // badges either.
      supabase
        .from('koth_claims')
        .select('id, exercise_id, user_id, metric_type, status, created_at, decided_at')
        .eq('group_id', groupId)
        .eq('counts_for_record', true),
      supabase.from('koth_records').select('exercise_id, current_claim_id').eq('group_id', groupId),
    ]);

    const claimIds = (kothClaimsRes.data ?? []).map((c) => c.id);
    const votesRes =
      claimIds.length > 0
        ? await supabase.from('koth_claim_votes').select('claim_id, vote').in('claim_id', claimIds)
        : { data: [] as { claim_id: string; vote: string }[] };
    const challengedClaimIds = new Set((votesRes.data ?? []).filter((v) => v.vote === 'yes').map((v) => v.claim_id));

    const nextKothClaims: KothClaimFact[] = (kothClaimsRes.data ?? []).map((c) => ({
      id: c.id,
      exerciseId: c.exercise_id,
      userId: c.user_id,
      metricType: c.metric_type,
      status: c.status,
      createdAt: c.created_at,
      decidedAt: c.decided_at,
      wasChallenged: challengedClaimIds.has(c.id),
    }));
    setKothClaims(nextKothClaims);

    const claimById = new Map(nextKothClaims.map((c) => [c.id, c]));
    const nextHeldByUser = new Map<string, string[]>();
    for (const record of kothRecordsRes.data ?? []) {
      if (!record.current_claim_id) continue;
      const claim = claimById.get(record.current_claim_id);
      if (!claim) continue;
      if (!nextHeldByUser.has(claim.userId)) nextHeldByUser.set(claim.userId, []);
      nextHeldByUser.get(claim.userId)!.push(record.exercise_id);
    }
    setKothCurrentlyHeldExerciseIdsByUser(nextHeldByUser);

    const nextCheckins = new Map<string, { date: string; hourBogota: number; workoutMinutes: number | null }[]>();
    for (const c of checkinsRes.data ?? []) {
      if (!nextCheckins.has(c.user_id)) nextCheckins.set(c.user_id, []);
      nextCheckins
        .get(c.user_id)!
        .push({ date: c.checkin_date, hourBogota: toZonedHour(new Date(c.captured_at), timezone), workoutMinutes: c.workout_minutes });
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

    setFundedWalletUsers(new Set((depositsRes.data ?? []).map((d) => d.user_id)));

    const reactions = (reactionsRes.data ?? []) as unknown as {
      user_id: string;
      created_at: string;
      checkin: { user_id: string } | null;
    }[];
    setRawReactions(
      reactions
        .filter((r) => r.checkin)
        .map((r) => ({ giverId: r.user_id, recipientId: r.checkin!.user_id, date: toZonedDateString(new Date(r.created_at), timezone) }))
    );

    const nextProposalsWon = new Map<string, number>();
    for (const p of proposalsRes.data ?? []) {
      nextProposalsWon.set(p.proposed_by, (nextProposalsWon.get(p.proposed_by) ?? 0) + 1);
    }
    setRuleProposalsWonByUser(nextProposalsWon);

    setExtrasLoading(false);
  }, [groupId, timezone]);

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
    const todayString = toZonedDateString(new Date(), timezone);
    return records.map((m) => {
      // A check-in/penalty/reaction from before this member's own activation
      // date isn't theirs to count — they weren't an accountable member of
      // the group yet (e.g. an admin backdated their join date to reset
      // practice-period history). m.days already applies this rule; the
      // extras fetched independently above need it applied here too.
      const activatedDate = m.activatedDate;
      const checkins = (checkinsByUser.get(m.userId) ?? []).filter((c) => !activatedDate || c.date >= activatedDate);
      const weeklyPenalties = (weeklyPenaltiesByUser.get(m.userId) ?? []).filter(
        (w) => !activatedDate || w.weekStartDate >= activatedDate
      );
      const reactionsGivenDates = rawReactions
        .filter((r) => r.giverId === m.userId && (!activatedDate || r.date >= activatedDate))
        .map((r) => r.date);
      const reactionsGivenByRecipient: Record<string, number> = {};
      for (const r of rawReactions) {
        if (r.giverId !== m.userId || (activatedDate && r.date < activatedDate)) continue;
        reactionsGivenByRecipient[r.recipientId] = (reactionsGivenByRecipient[r.recipientId] ?? 0) + 1;
      }
      const reactionsReceivedCount = rawReactions.filter(
        (r) => r.recipientId === m.userId && (!activatedDate || r.date >= activatedDate)
      ).length;

      const ctx: BadgeContext = {
        todayString,
        groupCreatedDate: groupCreatedDate ?? todayString,
        joinedDate: toZonedDateString(new Date(m.joinedAt), timezone),
        timezone,
        days: m.days,
        checkins,
        weeklyPenalties,
        hasFundedWallet: fundedWalletUsers.has(m.userId),
        reactionsGivenDates,
        reactionsGivenByRecipient,
        reactionsReceivedCount,
        ruleProposalsWonCount: ruleProposalsWonByUser.get(m.userId) ?? 0,
        kothClaims: kothClaims.filter((c) => c.userId === m.userId),
        kothCurrentlyHeldExerciseIds: kothCurrentlyHeldExerciseIdsByUser.get(m.userId) ?? [],
        kothIsGroupFounder: isKothGroupFounder(kothClaims, m.userId),
        kothReclaimedThroneCount: kothReclaimedThroneCount(kothClaims, m.userId),
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
    fundedWalletUsers,
    rawReactions,
    ruleProposalsWonByUser,
    kothClaims,
    kothCurrentlyHeldExerciseIdsByUser,
    monthlyByUserId,
    timezone,
  ]);

  return {
    membersBadges,
    isLoading: recordsLoading || extrasLoading || monthlyLoading,
    refresh,
  };
}
