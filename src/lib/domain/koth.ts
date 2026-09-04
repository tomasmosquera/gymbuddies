/**
 * Pure King of the Hill helpers — unit conversion and value formatting.
 * Mirrors the canonical-kg conversion submit_koth_claim does server-side
 * (supabase/migrations/0083_koth.sql) so a client-side preview matches what
 * the server will actually accept — the server always re-validates and
 * remains authoritative, this is display/advisory only.
 */

const KG_PER_LB = 0.45359237;

export type KothMetricType = 'weight_kg' | 'reps';

export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

export function kgToLbs(kg: number): number {
  return kg / KG_PER_LB;
}

/** Whichever unit the value was submitted in, always returns the canonical comparison value (kg for weight exercises, the rep count as-is otherwise). */
export function toCanonicalValue(metricType: KothMetricType, value: number, unit: 'kg' | 'lbs' | null): number {
  if (metricType === 'reps') return value;
  return unit === 'lbs' ? lbsToKg(value) : value;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "100 kg (220.5 lbs)" for weight exercises, "12 reps" for reps exercises — always shown in both units regardless of which one was submitted. */
export function formatKothValue(metricType: KothMetricType, canonicalValue: number): string {
  if (metricType === 'reps') {
    const reps = Math.round(canonicalValue);
    return `${reps} rep${reps === 1 ? '' : 's'}`;
  }
  return `${round1(canonicalValue)} kg (${round1(kgToLbs(canonicalValue))} lbs)`;
}

/** Client-side advisory only — submit_koth_claim always re-validates server-side and is authoritative. A claim must be strictly better than the current record; ties don't dethrone. */
export function beatsCurrentRecord(
  metricType: KothMetricType,
  candidateValue: number,
  candidateUnit: 'kg' | 'lbs' | null,
  currentRecordCanonicalValue: number | null
): boolean {
  if (currentRecordCanonicalValue === null) return candidateValue > 0;
  return toCanonicalValue(metricType, candidateValue, candidateUnit) > currentRecordCanonicalValue;
}

// ---- achievement helpers ----------------------------------------------------
// Every claim a member has ever made represents a moment they became champion
// of that exercise — submit_koth_claim always crowns immediately — even if a
// later claim (by them or someone else) or a lost vote has since superseded
// it. That's what makes "ever champion" and "reclaimed after losing it"
// derivable from the plain claim log alone, same spirit as badges.ts's
// completedStreakRuns: no separate bookkeeping table needed.

export interface KothClaimFact {
  id: string;
  exerciseId: string;
  userId: string;
  metricType: KothMetricType;
  status: 'pending_vote' | 'valid' | 'invalidated';
  /** When this claim was submitted (also when it became the exercise's champion). */
  createdAt: string;
  /** When voting/admin/timeout resolved this claim — null while still 'pending_vote'. */
  decidedAt: string | null;
  /** True if at least one member voted 'yes' (to invalidate) on this claim, regardless of the outcome. */
  wasChallenged: boolean;
}

/** The very first KOTH claim ever made in the group belongs to this user — "first to ever put a record on the board." */
export function isKothGroupFounder(allClaims: readonly KothClaimFact[], userId: string): boolean {
  if (allClaims.length === 0) return false;
  const earliest = allClaims.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
  return earliest.userId === userId;
}

export interface KothReclaimResult {
  count: number;
  /** createdAt of the earliest qualifying reclaim, across every exercise — null if never reclaimed. */
  firstReclaimDate: string | null;
}

/**
 * How many times this member has reclaimed an exercise's throne after
 * someone else took it from them — walks each exercise's claim history
 * (sorted chronologically) independently, counting a claim by `userId` as a
 * reclaim only when they had already held that exercise at some earlier
 * point AND the claim immediately before this one belonged to someone else
 * (proof they actually lost it, not just re-claimed their own dethroned-by-
 * nobody claim). Also collects each qualifying reclaim's createdAt, since
 * "the date this was first true" is what an XP-history entry needs — a
 * per-exercise reclaim's date isn't chronological across exercises just by
 * Map iteration order, so every date is collected then sorted.
 */
export function kothReclaimedThroneCountWithDate(allClaims: readonly KothClaimFact[], userId: string): KothReclaimResult {
  const byExercise = new Map<string, KothClaimFact[]>();
  for (const claim of allClaims) {
    if (!byExercise.has(claim.exerciseId)) byExercise.set(claim.exerciseId, []);
    byExercise.get(claim.exerciseId)!.push(claim);
  }

  const reclaimDates: string[] = [];
  for (const claims of byExercise.values()) {
    const sorted = [...claims].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let heldBefore = false;
    let previousUserId: string | null = null;
    for (const claim of sorted) {
      if (claim.userId === userId) {
        if (heldBefore && previousUserId !== userId) reclaimDates.push(claim.createdAt);
        heldBefore = true;
      }
      previousUserId = claim.userId;
    }
  }
  reclaimDates.sort();
  return { count: reclaimDates.length, firstReclaimDate: reclaimDates[0] ?? null };
}

/** @deprecated prefer kothReclaimedThroneCountWithDate when a date is also needed — kept as a thin wrapper so existing call sites/tests are untouched. */
export function kothReclaimedThroneCount(allClaims: readonly KothClaimFact[], userId: string): number {
  return kothReclaimedThroneCountWithDate(allClaims, userId).count;
}

// ---- historical simultaneous-hold reconstruction ---------------------------
// multi-corona/rey-absoluto/dueno-del-gym/doble-amenaza used to read
// ctx.kothCurrentlyHeldExerciseIds — a live snapshot of "what do you hold
// right now" — which meant these 4 badges could un-earn themselves if a
// member later lost records, breaking this app's core "lifetime badges are
// monotonic" invariant (the only accepted exception is
// 'ahorrador-involuntario', deliberately worth 0 XP for exactly that
// reason). The functions below instead reconstruct the member's FULL
// history of which exercises they held and when, so "earned" can depend on
// the historical peak (monotonic, like every other badge) and the earned
// date can point at the real moment that peak first happened.

interface HoldingInterval {
  userId: string;
  /** createdAt of the claim that started holding it. */
  start: string;
  /** createdAt of the claim that dethroned it, or the decidedAt it was invalidated at; null = still held as of the data available. */
  end: string | null;
}

/**
 * For one exercise's full claim list, reconstructs who held it and during
 * which interval — mirrors refresh_koth_record's own rule (the
 * server-side function that recomputes koth_records.current_claim_id
 * whenever a claim is invalidated): at any instant, the holder is the claim
 * with the latest createdAt among claims that already exist and aren't
 * (invalidated AND already decided) as of that instant. Submitting a new
 * claim always dethrones immediately, at its own createdAt, regardless of
 * the old claim's vote status (0083_koth.sql's "regla clave"); a claim can
 * only ever be invalidated while it's still the current holder (once
 * dethroned it's permanently locked to whatever it already was), so when
 * the current claim IS invalidated, the holder reverts to the most recent
 * still-valid claim before it — which this walk naturally re-derives at
 * each boundary rather than assuming it can never happen.
 */
function computeHoldingIntervals(claimsForExercise: readonly KothClaimFact[]): HoldingInterval[] {
  const sorted = [...claimsForExercise].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const boundaries = new Set<string>();
  for (const c of sorted) {
    boundaries.add(c.createdAt);
    if (c.status === 'invalidated' && c.decidedAt) boundaries.add(c.decidedAt);
  }
  const sortedBoundaries = [...boundaries].sort();

  const intervals: HoldingInterval[] = [];
  let prevHolder: string | null = null;
  let prevStart: string | null = null;
  for (const t of sortedBoundaries) {
    const candidates = sorted.filter(
      (c) => c.createdAt <= t && !(c.status === 'invalidated' && c.decidedAt !== null && c.decidedAt <= t)
    );
    const current = candidates.length > 0 ? candidates.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b)) : null;
    const holderId = current?.userId ?? null;
    if (holderId !== prevHolder) {
      if (prevHolder !== null && prevStart !== null) intervals.push({ userId: prevHolder, start: prevStart, end: t });
      prevHolder = holderId;
      prevStart = t;
    }
  }
  if (prevHolder !== null && prevStart !== null) intervals.push({ userId: prevHolder, start: prevStart, end: null });
  return intervals;
}

export interface SimultaneousHoldEvent {
  date: string;
  /** How many exercises this member held at once, immediately after this event. */
  count: number;
  /** Which metric types were represented among the exercises held at this point. */
  metricTypes: Set<KothMetricType>;
}

/**
 * The member's real chronological timeline of "how many exercises did I
 * hold at once" — built from `allClaims` (the FULL group log, not just this
 * member's own claims: knowing exactly when they lost an exercise requires
 * knowing when someone ELSE claimed it, same reason isKothGroupFounder/
 * kothReclaimedThroneCount also take the full list). Unlike a live
 * snapshot, this only ever grows and shrinks with real history — the
 * historical MAXIMUM (kothMaxSimultaneousHeld) is monotonic by
 * construction: once reached, it's a fact about the past that can't be
 * undone by later losing records.
 */
export function kothSimultaneousHoldTimeline(allClaims: readonly KothClaimFact[], userId: string): SimultaneousHoldEvent[] {
  const byExercise = new Map<string, KothClaimFact[]>();
  for (const claim of allClaims) {
    if (!byExercise.has(claim.exerciseId)) byExercise.set(claim.exerciseId, []);
    byExercise.get(claim.exerciseId)!.push(claim);
  }

  const userIntervals: { start: string; end: string | null; metricType: KothMetricType }[] = [];
  for (const claims of byExercise.values()) {
    const metricType = claims[0]?.metricType;
    if (!metricType) continue;
    for (const iv of computeHoldingIntervals(claims)) {
      if (iv.userId === userId) userIntervals.push({ start: iv.start, end: iv.end, metricType });
    }
  }
  if (userIntervals.length === 0) return [];

  const events: { date: string; delta: 1 | -1; metricType: KothMetricType }[] = [];
  for (const iv of userIntervals) {
    events.push({ date: iv.start, delta: 1, metricType: iv.metricType });
    if (iv.end !== null) events.push({ date: iv.end, delta: -1, metricType: iv.metricType });
  }
  // Starts before ends at the exact same instant, so a same-instant handoff still registers as briefly simultaneous.
  events.sort((a, b) => a.date.localeCompare(b.date) || b.delta - a.delta);

  const activeCountByType = new Map<KothMetricType, number>();
  let count = 0;
  const timeline: SimultaneousHoldEvent[] = [];
  for (const e of events) {
    count += e.delta;
    activeCountByType.set(e.metricType, (activeCountByType.get(e.metricType) ?? 0) + e.delta);
    const metricTypes = new Set<KothMetricType>();
    for (const [type, n] of activeCountByType) if (n > 0) metricTypes.add(type);
    timeline.push({ date: e.date, count, metricTypes });
  }
  return timeline;
}

/** Historical peak of `count` across the timeline — the value multi-corona/rey-absoluto/dueno-del-gym now earn against, instead of a live snapshot. */
export function kothMaxSimultaneousHeld(timeline: readonly SimultaneousHoldEvent[]): number {
  return timeline.reduce((max, e) => Math.max(max, e.count), 0);
}

/** First date the timeline's count reaches `target` — the earnedDate for multi-corona(3)/rey-absoluto(6)/dueno-del-gym(12). */
export function dateFirstReachedSimultaneousCount(timeline: readonly SimultaneousHoldEvent[], target: number): string | null {
  return timeline.find((e) => e.count >= target)?.date ?? null;
}

/** First date the timeline shows both metric types held at once — earned/earnedDate for doble-amenaza. */
export function dateFirstHadBothMetricTypes(timeline: readonly SimultaneousHoldEvent[]): string | null {
  return timeline.find((e) => e.metricTypes.has('weight_kg') && e.metricTypes.has('reps'))?.date ?? null;
}

/** Distinct exercise ids this member became champion of during `month` (YYYY-MM) — for monthly challenges that count fresh claims. */
export function kothClaimedExerciseIdsInMonth(claims: readonly KothClaimFact[], userId: string, month: string): string[] {
  return [
    ...new Set(
      claims.filter((c) => c.userId === userId && c.createdAt.slice(0, 7) === month).map((c) => c.exerciseId)
    ),
  ];
}

/** True if this member successfully defended (survived a real invalidate vote on) at least one claim, decided during `month`. */
export function kothDefendedInMonth(claims: readonly KothClaimFact[], userId: string, month: string): boolean {
  return claims.some(
    (c) => c.userId === userId && c.status === 'valid' && c.wasChallenged && c.decidedAt?.slice(0, 7) === month
  );
}

/**
 * Distinct exercise ids this member had genuine KOTH activity on during
 * `month` — claimed fresh, or successfully defended from a real challenge.
 * Deliberately excludes exercises they merely still hold from months ago
 * with no activity this month, so a static, unchallenged record can't farm
 * "Rey del Mes" forever on its own (see kothDefendedInMonth's doc comment
 * in monthlyChallenges.ts for the reasoning).
 */
export function kothActiveExerciseIdsInMonth(claims: readonly KothClaimFact[], userId: string, month: string): string[] {
  const ids = new Set(kothClaimedExerciseIdsInMonth(claims, userId, month));
  for (const c of claims) {
    if (c.userId === userId && c.status === 'valid' && c.wasChallenged && c.decidedAt?.slice(0, 7) === month) {
      ids.add(c.exerciseId);
    }
  }
  return [...ids];
}
