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

/**
 * How many times this member has reclaimed an exercise's throne after
 * someone else took it from them — walks each exercise's claim history
 * (sorted chronologically) independently, counting a claim by `userId` as a
 * reclaim only when they had already held that exercise at some earlier
 * point AND the claim immediately before this one belonged to someone else
 * (proof they actually lost it, not just re-claimed their own dethroned-by-
 * nobody claim).
 */
export function kothReclaimedThroneCount(allClaims: readonly KothClaimFact[], userId: string): number {
  const byExercise = new Map<string, KothClaimFact[]>();
  for (const claim of allClaims) {
    if (!byExercise.has(claim.exerciseId)) byExercise.set(claim.exerciseId, []);
    byExercise.get(claim.exerciseId)!.push(claim);
  }

  let count = 0;
  for (const claims of byExercise.values()) {
    const sorted = [...claims].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let heldBefore = false;
    let previousUserId: string | null = null;
    for (const claim of sorted) {
      if (claim.userId === userId) {
        if (heldBefore && previousUserId !== userId) count++;
        heldBefore = true;
      }
      previousUserId = claim.userId;
    }
  }
  return count;
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
