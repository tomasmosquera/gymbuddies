import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString, toZonedHour } from '@/lib/domain/dateUtils';
import { monthlyConsistency, type BadgeCheckinFact } from '@/lib/domain/badges';
import { buildHeatmapWeeks, checkinHourBuckets, weekdayCompletionRates } from '@/lib/domain/personalStats';
import { buildMemberSummary, generateInsights, percentileAmong, type Insight, type MemberSummary } from '@/lib/domain/personalStatsV2';
import { useGroupAttendanceRecords } from '@/hooks/useGroupAttendanceRecords';
import { useGroupBadges } from '@/hooks/useGroupBadges';

export interface PersonalStatsV2 {
  /**
   * Null for a viewer who isn't a playing member of the group — an
   * admin_only admin, who never has a records row of their own (see
   * fetchGroupAttendanceRecords' status filter). Every "mine"-flavored field
   * below (myRank, gbScorePercentile, insights, heatmapWeeks) is null right
   * alongside it for the same reason; allMembers/groupSize stay populated
   * regardless, since that's the whole group's data, not "mine".
   */
  me: MemberSummary | null;
  /** Everyone except `me`, alphabetical — the "Cara a cara" picker's list. Empty (not "everyone") when me is null. */
  teammates: MemberSummary[];
  /** Every playing member, sorted by GB Score (best first) — what an admin_only viewer's group-ranking table reads from. */
  allMembers: MemberSummary[];
  /** 1-based, ties share a rank (same convention as rankMembersByConsistency). Null when me is null. */
  myRank: number | null;
  groupSize: number;
  /** "Mejor que el N% del grupo" in GB Score — null with too few comparable teammates, or when me is null. */
  gbScorePercentile: number | null;
  insights: Insight[];
  heatmapWeeks: ReturnType<typeof buildHeatmapWeeks> | null;
  currency: string;
  requireCheckoutPhoto: boolean;
}

const HEATMAP_WEEKS_TO_SHOW = 20;

/**
 * Estadísticas V2 — reuses the same two data sources V1's screen and the
 * Home/Dashboard ranking already fetch (useGroupAttendanceRecords,
 * useGroupBadges), plus one small extra query of its own (checkins +
 * penalties, group-wide) for the totals/calories/money a head-to-head
 * comparison needs. Deliberately its own hook rather than an extension of
 * usePersonalStats — V1 stays untouched, this only adds on top.
 */
export function usePersonalStatsV2(groupId: string | null, userId: string | null, timezone: string) {
  const { records, isLoading: recordsLoading, refresh: refreshRecords } = useGroupAttendanceRecords(groupId, timezone);
  const { membersBadges, isLoading: badgesLoading, refresh: refreshBadges } = useGroupBadges(groupId, timezone);

  const [checkinsByUser, setCheckinsByUser] = useState<
    Map<string, { workoutMinutes: number | null; activeEnergyKcal: number | null; hourBogota: number; date: string }[]>
  >(new Map());
  const [penaltiesByUser, setPenaltiesByUser] = useState<Map<string, number>>(new Map());
  const [groupInfo, setGroupInfo] = useState<{ currency: string; requireCheckoutPhoto: boolean } | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(true);

  const refreshExtras = useCallback(async () => {
    if (!groupId) {
      setCheckinsByUser(new Map());
      setPenaltiesByUser(new Map());
      setGroupInfo(null);
      setExtrasLoading(false);
      return;
    }
    setExtrasLoading(true);
    const todayString = toZonedDateString(new Date(), timezone);

    const [checkinsRes, resultsRes, groupRes] = await Promise.all([
      supabase
        .from('checkins')
        .select('user_id, checkin_date, captured_at, workout_minutes, active_energy_kcal')
        .eq('group_id', groupId)
        .lte('checkin_date', todayString),
      supabase.from('weekly_evaluation_results').select('user_id, penalty_charged').eq('group_id', groupId),
      supabase.from('groups').select('currency, require_checkout_photo').eq('id', groupId).single(),
    ]);

    const nextCheckins = new Map<
      string,
      { workoutMinutes: number | null; activeEnergyKcal: number | null; hourBogota: number; date: string }[]
    >();
    for (const c of (checkinsRes.data ?? []) as {
      user_id: string;
      checkin_date: string;
      captured_at: string;
      workout_minutes: number | null;
      active_energy_kcal: number | null;
    }[]) {
      if (!nextCheckins.has(c.user_id)) nextCheckins.set(c.user_id, []);
      nextCheckins.get(c.user_id)!.push({
        date: c.checkin_date,
        hourBogota: toZonedHour(new Date(c.captured_at), timezone),
        workoutMinutes: c.workout_minutes,
        activeEnergyKcal: c.active_energy_kcal,
      });
    }
    setCheckinsByUser(nextCheckins);

    const nextPenalties = new Map<string, number>();
    for (const r of (resultsRes.data ?? []) as { user_id: string; penalty_charged: number }[]) {
      nextPenalties.set(r.user_id, (nextPenalties.get(r.user_id) ?? 0) + r.penalty_charged);
    }
    setPenaltiesByUser(nextPenalties);

    setGroupInfo(
      groupRes.data ? { currency: groupRes.data.currency, requireCheckoutPhoto: groupRes.data.require_checkout_photo } : null
    );
    setExtrasLoading(false);
  }, [groupId, timezone]);

  useEffect(() => {
    refreshExtras();
  }, [refreshExtras]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshRecords(), refreshBadges(), refreshExtras()]);
  }, [refreshRecords, refreshBadges, refreshExtras]);

  const data = useMemo<PersonalStatsV2 | null>(() => {
    if (!groupInfo || records.length === 0) return null;
    const todayString = toZonedDateString(new Date(), timezone);
    const badgesByUserId = new Map(membersBadges.map((b) => [b.userId, b]));

    const summaries = records.map((m) => {
      const badges = badgesByUserId.get(m.userId);
      const checkins = checkinsByUser.get(m.userId) ?? [];
      return buildMemberSummary({
        userId: m.userId,
        fullName: m.fullName,
        days: m.days,
        joinedAt: m.joinedAt,
        activatedDate: m.activatedDate,
        timezone,
        todayString,
        checkins,
        totalPenalties: penaltiesByUser.get(m.userId) ?? 0,
        level: badges?.level.level ?? 0,
        totalXp: badges?.level.totalXp ?? 0,
        earnedBadgesCount: badges?.earnedCount ?? 0,
        kothValidClaims: badges?.kothClaims.filter((c) => c.status === 'valid').length ?? 0,
        requireCheckoutPhoto: groupInfo.requireCheckoutPhoto,
      });
    });
    const allMembers = [...summaries].sort((a, b) => (b.gbScore ?? -1) - (a.gbScore ?? -1));

    // userId itself can be missing from `records` entirely — an admin_only
    // viewer never has one (fetchGroupAttendanceRecords only pulls active/
    // needs_recharge members), since they don't play. Every "mine" field
    // stays null for them; allMembers/groupSize above are already the whole
    // group's data regardless, which is what an admin_only Estadísticas
    // screen actually shows instead.
    const me = userId ? (summaries.find((s) => s.userId === userId) ?? null) : null;
    if (!me) {
      return {
        me: null,
        teammates: [],
        allMembers,
        myRank: null,
        groupSize: summaries.length,
        gbScorePercentile: null,
        insights: [],
        heatmapWeeks: null,
        currency: groupInfo.currency,
        requireCheckoutPhoto: groupInfo.requireCheckoutPhoto,
      };
    }
    const teammates = summaries.filter((s) => s.userId !== userId).sort((a, b) => a.fullName.localeCompare(b.fullName));

    // Rank by GB Score alone — same metric and same standard-competition-rank
    // convention (ties share a rank) as the Home/Dashboard ranking, just
    // computed locally here instead of importing rankMembersByConsistency,
    // since summaries are already MemberSummary, not MemberConsistencyInput.
    const myRank = 1 + teammates.filter((t) => (t.gbScore ?? -1) > (me.gbScore ?? -1)).length;

    const gbScorePercentile = percentileAmong(
      me.gbScore,
      teammates.map((t) => t.gbScore)
    );

    // --- Insights: reuse V1's own pure shaping functions on "me" alone ---
    const meRecord = records.find((m) => m.userId === userId)!;
    const myCheckinFacts: BadgeCheckinFact[] = (checkinsByUser.get(userId!) ?? []).map((c) => ({
      date: c.date,
      hourBogota: c.hourBogota,
      workoutMinutes: c.workoutMinutes,
    }));
    const weekdayRates = weekdayCompletionRates(meRecord.days);
    const hourBuckets = checkinHourBuckets(myCheckinFacts);
    const myMonthly = monthlyConsistency(meRecord.days).filter((m) => m.month < todayString.slice(0, 7));
    const lastTwoClosedMonths = myMonthly.slice(-2).map((m) => ({ month: m.month, percent: m.percent }));
    const insights = generateInsights({
      weekdayRates,
      hourBuckets,
      currentStreak: me.currentStreak,
      lastTwoClosedMonths,
      gbScore: me.gbScore,
    });

    return {
      me,
      teammates,
      allMembers,
      myRank,
      groupSize: summaries.length,
      gbScorePercentile,
      insights,
      heatmapWeeks: buildHeatmapWeeks(meRecord.days, todayString, HEATMAP_WEEKS_TO_SHOW),
      currency: groupInfo.currency,
      requireCheckoutPhoto: groupInfo.requireCheckoutPhoto,
    };
  }, [records, membersBadges, checkinsByUser, penaltiesByUser, groupInfo, userId, timezone]);

  return { data, isLoading: recordsLoading || badgesLoading || extrasLoading, refresh };
}
