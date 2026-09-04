import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString, toZonedHour } from '@/lib/domain/dateUtils';
import { fetchGroupAttendanceRecords, type MemberAttendanceRecord } from '@/hooks/useGroupAttendanceRecords';
import { fetchGroupMonthlyChallenges, type MemberMonthlyChallenges } from '@/hooks/useGroupMonthlyChallenges';
import { BADGES, type BadgeContext, type BadgeStatus } from '@/lib/domain/badges';
import { buddyCheckinXp, checkinXp, kothClaimXp, levelProgress, totalXpForEarnedBadges, type LevelProgress } from '@/lib/domain/xp';
import {
  isKothGroupFounder,
  kothReclaimedThroneCountWithDate,
  kothSimultaneousHoldTimeline,
  type KothClaimFact,
} from '@/lib/domain/koth';
import { findBuddyCheckinKeys } from '@/lib/domain/geo';
import type { MonthlyChallengeStatus } from '@/lib/domain/monthlyChallenges';

export interface MemberBadges {
  userId: string;
  fullName: string;
  statuses: Record<string, BadgeStatus>;
  earnedCount: number;
  monthlyStatuses: Record<string, MonthlyChallengeStatus>;
  /** Level combines lifetime badge XP and monthly challenge XP (see xp.ts) — always the single source of truth for a member's level everywhere it's shown. */
  level: LevelProgress;
  /** XP earned from valid KOTH claims alone (kothClaimXp in xp.ts) — already folded into `level` above; broken out separately so the King of the Hill section can show its own running total. */
  kothClaimXpTotal: number;
  /** XP earned from check-ins alone (checkinXp in xp.ts, 5 per valid check-in) — already folded into `level` above; broken out in case a future summary line wants it, same pattern as kothClaimXpTotal. Deliberately NOT surfaced per-check-in in the XP-history list — one entry per check-in would be far too many rows. */
  checkinXpTotal: number;
  /** This member's own KOTH claims — same list badges.ts's evaluate() already saw via ctx.kothClaims, exposed here too so a caller (the XP-history modal) can build a dated entry per valid claim without a second fetch. */
  kothClaims: readonly KothClaimFact[];
  /** XP earned from buddy check-ins alone (buddyCheckinXp in xp.ts, 3 per buddy check-in) — already folded into `level` above; broken out same as kothClaimXpTotal/checkinXpTotal. */
  buddyCheckinXpTotal: number;
  /** How many of this member's check-ins were buddy check-ins — same count badges.ts's 'dupla'/'mejor-acompanado' evaluate() saw via ctx.buddyCheckinDates.length. */
  buddyCheckinCount: number;
}

/**
 * The actual fetch + evaluation, as a plain function — pulled out of the
 * hook below so a caller that needs this for several groups at once (e.g.
 * useMyGroupsSummary, one group per membership) can call it in a
 * loop/Promise.all without breaking the rules of hooks. Takes
 * records/groupCreatedDate/membersChallenges as params (from
 * fetchGroupAttendanceRecords/fetchGroupMonthlyChallenges) rather than
 * fetching them itself, so a caller that already has them doesn't pay for
 * those fetches twice.
 *
 * Evaluates the full badge catalog (src/lib/domain/badges.ts) for every
 * active member of a group. Badges are computed live from existing data —
 * there is no badges table — so a member who already qualifies today shows
 * as earned immediately, with no backfill step needed.
 */
export async function fetchGroupBadges(
  groupId: string,
  timezone: string,
  records: MemberAttendanceRecord[],
  groupCreatedDate: string | null,
  membersChallenges: MemberMonthlyChallenges[]
): Promise<MemberBadges[]> {
  const todayString = toZonedDateString(new Date(), timezone);

  const [checkinsRes, resultsRes, depositsRes, reactionsRes, proposalsRes, kothClaimsRes, kothRecordsRes] = await Promise.all([
    supabase
      .from('checkins')
      .select('user_id, checkin_date, captured_at, workout_minutes, latitude, longitude')
      .eq('group_id', groupId)
      .lte('checkin_date', todayString),
    supabase
      .from('weekly_evaluation_results')
      .select('user_id, penalty_charged, run:weekly_evaluation_runs(week_start_date)')
      .eq('group_id', groupId),
    supabase
      .from('wallet_transactions')
      .select('user_id, created_at')
      .eq('group_id', groupId)
      .in('type', ['initial_deposit', 'recharge'])
      .eq('status', 'confirmed'),
    supabase
      .from('checkin_reactions')
      .select('user_id, created_at, checkin:checkins(user_id)')
      .eq('group_id', groupId),
    supabase
      .from('rule_proposals')
      .select('proposed_by, status, decided_at, applied_at')
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

  const kothClaims: KothClaimFact[] = (kothClaimsRes.data ?? []).map((c) => ({
    id: c.id,
    exerciseId: c.exercise_id,
    userId: c.user_id,
    metricType: c.metric_type,
    status: c.status,
    createdAt: c.created_at,
    decidedAt: c.decided_at,
    wasChallenged: challengedClaimIds.has(c.id),
  }));

  const claimById = new Map(kothClaims.map((c) => [c.id, c]));
  const kothCurrentlyHeldExerciseIdsByUser = new Map<string, string[]>();
  for (const record of kothRecordsRes.data ?? []) {
    if (!record.current_claim_id) continue;
    const claim = claimById.get(record.current_claim_id);
    if (!claim) continue;
    if (!kothCurrentlyHeldExerciseIdsByUser.has(claim.userId)) kothCurrentlyHeldExerciseIdsByUser.set(claim.userId, []);
    kothCurrentlyHeldExerciseIdsByUser.get(claim.userId)!.push(record.exercise_id);
  }

  const checkinsByUser = new Map<string, { date: string; hourBogota: number; workoutMinutes: number | null }[]>();
  for (const c of checkinsRes.data ?? []) {
    if (!checkinsByUser.has(c.user_id)) checkinsByUser.set(c.user_id, []);
    checkinsByUser
      .get(c.user_id)!
      .push({ date: c.checkin_date, hourBogota: toZonedHour(new Date(c.captured_at), timezone), workoutMinutes: c.workout_minutes });
  }

  // Buddy check-ins: group-wide first (needs every member's check-ins to
  // find pairs), then tallied per member below against their own already
  // activation-filtered `checkins` list — same "not theirs before they were
  // an accountable member" rule everything else here applies.
  const buddyCheckinKeys = findBuddyCheckinKeys(
    (checkinsRes.data ?? []).map((c) => ({
      userId: c.user_id,
      date: c.checkin_date,
      capturedAtMs: new Date(c.captured_at).getTime(),
      latitude: c.latitude,
      longitude: c.longitude,
    }))
  );

  const results = (resultsRes.data ?? []) as unknown as {
    user_id: string;
    penalty_charged: number;
    run: { week_start_date: string } | null;
  }[];
  const weeklyPenaltiesByUser = new Map<string, { weekStartDate: string; penaltyCharged: number }[]>();
  for (const r of results) {
    if (!r.run) continue;
    if (!weeklyPenaltiesByUser.has(r.user_id)) weeklyPenaltiesByUser.set(r.user_id, []);
    weeklyPenaltiesByUser.get(r.user_id)!.push({ weekStartDate: r.run.week_start_date, penaltyCharged: r.penalty_charged });
  }

  const fundedWalletUsers = new Set((depositsRes.data ?? []).map((d) => d.user_id));
  const fundedWalletDatesByUser = new Map<string, string>();
  for (const d of depositsRes.data ?? []) {
    const date = toZonedDateString(new Date(d.created_at), timezone);
    const existing = fundedWalletDatesByUser.get(d.user_id);
    if (!existing || date < existing) fundedWalletDatesByUser.set(d.user_id, date);
  }

  const reactions = (reactionsRes.data ?? []) as unknown as {
    user_id: string;
    created_at: string;
    checkin: { user_id: string } | null;
  }[];
  const rawReactions = reactions
    .filter((r) => r.checkin)
    .map((r) => ({ giverId: r.user_id, recipientId: r.checkin!.user_id, date: toZonedDateString(new Date(r.created_at), timezone) }));

  const ruleProposalsWonByUser = new Map<string, number>();
  // decided_at is confirmed to never be null for a row already filtered to
  // status in ('approved','applied') — applied_at only lags it for a
  // deferred (non-immediate) proposal not yet swept by the Monday cron.
  const ruleProposalWinDatesByUser = new Map<string, string>();
  for (const p of proposalsRes.data ?? []) {
    ruleProposalsWonByUser.set(p.proposed_by, (ruleProposalsWonByUser.get(p.proposed_by) ?? 0) + 1);
    const winDate = toZonedDateString(new Date(p.applied_at ?? p.decided_at!), timezone);
    const existing = ruleProposalWinDatesByUser.get(p.proposed_by);
    if (!existing || winDate < existing) ruleProposalWinDatesByUser.set(p.proposed_by, winDate);
  }

  const monthlyByUserId = new Map(membersChallenges.map((m) => [m.userId, m]));

  return records.map((m) => {
    // A check-in/penalty/reaction from before this member's own activation
    // date isn't theirs to count — they weren't an accountable member of
    // the group yet (e.g. an admin backdated their join date to reset
    // practice-period history). m.days already applies this rule; the
    // extras fetched independently above need it applied here too.
    const activatedDate = m.activatedDate;
    // Neither the checkins nor weekly_evaluation_results query above has an
    // .order(...), so these arrive in whatever order Postgres happens to
    // return them — sorted here so badges.ts's "Nth checkin"/"Nth week"
    // date derivations (e.g. donde-estas' 10th checkin) are actually
    // correct. ctx.days doesn't need this: it's built ascending in
    // useGroupAttendanceRecords.ts via enumerateDates.
    const checkins = (checkinsByUser.get(m.userId) ?? [])
      .filter((c) => !activatedDate || c.date >= activatedDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    const weeklyPenalties = (weeklyPenaltiesByUser.get(m.userId) ?? [])
      .filter((w) => !activatedDate || w.weekStartDate >= activatedDate)
      .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
    const reactionsGivenDates = rawReactions
      .filter((r) => r.giverId === m.userId && (!activatedDate || r.date >= activatedDate))
      .map((r) => r.date)
      .sort();
    const reactionsGivenByRecipient: Record<string, number> = {};
    const reactionsGivenToRecipientDates: Record<string, string[]> = {};
    for (const r of rawReactions) {
      if (r.giverId !== m.userId || (activatedDate && r.date < activatedDate)) continue;
      reactionsGivenByRecipient[r.recipientId] = (reactionsGivenByRecipient[r.recipientId] ?? 0) + 1;
      (reactionsGivenToRecipientDates[r.recipientId] ??= []).push(r.date);
    }
    for (const dates of Object.values(reactionsGivenToRecipientDates)) dates.sort();
    const reactionsReceivedDates = rawReactions
      .filter((r) => r.recipientId === m.userId && (!activatedDate || r.date >= activatedDate))
      .map((r) => r.date)
      .sort();
    const reactionsReceivedCount = reactionsReceivedDates.length;

    const memberKothClaims = kothClaims.filter((c) => c.userId === m.userId);
    const reclaim = kothReclaimedThroneCountWithDate(kothClaims, m.userId);
    const buddyCheckinDates = checkins.filter((c) => buddyCheckinKeys.has(`${m.userId}|${c.date}`)).map((c) => c.date);
    const ctx: BadgeContext = {
      todayString,
      groupCreatedDate: groupCreatedDate ?? todayString,
      joinedDate: toZonedDateString(new Date(m.joinedAt), timezone),
      timezone,
      days: m.days,
      checkins,
      weeklyPenalties,
      hasFundedWallet: fundedWalletUsers.has(m.userId),
      fundedWalletDate: fundedWalletDatesByUser.get(m.userId) ?? null,
      reactionsGivenDates,
      reactionsGivenByRecipient,
      reactionsGivenToRecipientDates,
      reactionsReceivedCount,
      reactionsReceivedDates,
      ruleProposalsWonCount: ruleProposalsWonByUser.get(m.userId) ?? 0,
      firstRuleProposalWinDate: ruleProposalWinDatesByUser.get(m.userId) ?? null,
      kothClaims: memberKothClaims,
      kothCurrentlyHeldExerciseIds: kothCurrentlyHeldExerciseIdsByUser.get(m.userId) ?? [],
      kothIsGroupFounder: isKothGroupFounder(kothClaims, m.userId),
      kothReclaimedThroneCount: reclaim.count,
      kothFirstReclaimDate: reclaim.firstReclaimDate,
      kothSimultaneousHoldTimeline: kothSimultaneousHoldTimeline(kothClaims, m.userId),
      buddyCheckinDates,
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
    const kothValidClaimCount = ctx.kothClaims.filter((c) => c.status === 'valid').length;
    const kothClaimXpTotal = kothClaimXp(kothValidClaimCount);
    const checkinXpTotal = checkinXp(ctx.checkins.length);
    const buddyCheckinXpTotal = buddyCheckinXp(ctx.buddyCheckinDates.length);
    return {
      userId: m.userId,
      fullName: m.fullName,
      statuses,
      earnedCount: earnedBadgeIds.length,
      monthlyStatuses: monthly?.statusesById ?? {},
      level: levelProgress(lifetimeXp + (monthly?.totalXp ?? 0) + kothClaimXpTotal + checkinXpTotal + buddyCheckinXpTotal),
      kothClaimXpTotal,
      checkinXpTotal,
      kothClaims: memberKothClaims,
      buddyCheckinXpTotal,
      buddyCheckinCount: ctx.buddyCheckinDates.length,
    };
  });
}

/**
 * Evaluates the full badge catalog (src/lib/domain/badges.ts) for every
 * active member of a group. Badges are computed live from existing data —
 * there is no badges table — so a member who already qualifies today shows
 * as earned immediately, with no backfill step needed.
 */
export function useGroupBadges(groupId: string | null, timezone: string) {
  const [membersBadges, setMembersBadges] = useState<MemberBadges[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setMembersBadges([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { records, groupCreatedDate } = await fetchGroupAttendanceRecords(groupId, timezone);
    const membersChallenges = await fetchGroupMonthlyChallenges(groupId, timezone, records, groupCreatedDate);
    const result = await fetchGroupBadges(groupId, timezone, records, groupCreatedDate, membersChallenges);
    setMembersBadges(result);
    setIsLoading(false);
  }, [groupId, timezone]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { membersBadges, isLoading, refresh };
}
