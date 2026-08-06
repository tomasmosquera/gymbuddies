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
