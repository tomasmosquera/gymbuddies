import { getWeekBoundsForDateString } from './dateUtils';
import { ALL_DRAWABLE_BODY_PARTS, MUSCLE_GROUP_TO_BODY_PARTS, SECONDARY_MUSCLE_TO_BODY_PARTS, type MuscleMapBodyPart } from './muscleBodyParts';
import type { MuscleGroup } from '@/lib/supabase/types';

export interface MuscleTrainingEntry {
  muscleGroup: MuscleGroup;
  secondaryMuscles: readonly string[];
  /** The session's own date — only the leading YYYY-MM-DD is read, so a full ISO timestamp works too. */
  startedAt: string;
  sets: readonly { isWarmup: boolean }[];
}

const PRIMARY_WEIGHT = 1;
const SECONDARY_WEIGHT = 0.5;

/**
 * Weighted, non-warmup set counts per drawable body part across `entries` on or after
 * `sinceDate` (inclusive; null = no lower bound, i.e. "Todo") — the Stats screen's "Balance
 * muscular" bars. Same 100%/50% primary/secondary weighting muscleDistribution.ts and the
 * exercise-detail diagram already use, just at MuscleMapBodyPart's finer ~17-region grain
 * instead of muscleDistribution's 7 buckets — a chest day credits both 'chest' and 'serratus',
 * a back day credits 'trapezius'/'upper-back'/'lower-back' all at once, same fan-out
 * MUSCLE_GROUP_TO_BODY_PARTS already does for the plan-based diagram.
 */
export function computeMuscleVolume(
  entries: readonly MuscleTrainingEntry[],
  sinceDate: string | null
): Partial<Record<MuscleMapBodyPart, number>> {
  const counts: Partial<Record<MuscleMapBodyPart, number>> = {};
  const credit = (part: MuscleMapBodyPart, amount: number) => {
    counts[part] = (counts[part] ?? 0) + amount;
  };
  for (const entry of entries) {
    if (sinceDate && entry.startedAt.slice(0, 10) < sinceDate) continue;
    const realSetCount = entry.sets.filter((s) => !s.isWarmup).length;
    if (realSetCount === 0) continue;

    const primaryParts = MUSCLE_GROUP_TO_BODY_PARTS[entry.muscleGroup] ?? [];
    for (const part of primaryParts) credit(part, realSetCount * PRIMARY_WEIGHT);

    const secondaryParts = new Set<MuscleMapBodyPart>();
    for (const raw of entry.secondaryMuscles) {
      for (const part of SECONDARY_MUSCLE_TO_BODY_PARTS[raw] ?? []) {
        if (!primaryParts.includes(part)) secondaryParts.add(part);
      }
    }
    for (const part of secondaryParts) credit(part, realSetCount * SECONDARY_WEIGHT);
  }
  return counts;
}

function daysBetween(dateString: string, todayString: string): number {
  const [y1, m1, d1] = dateString.split('-').map(Number);
  const [y2, m2, d2] = todayString.split('-').map(Number);
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Days since each drawable body part was last touched (primary or secondary, no volume
 * weighting — this is about recency, not how much) across every entry regardless of date window
 * (unlike computeMuscleVolume, fatigue always looks at the member's whole history). A part never
 * trained at all is left out of the returned record entirely.
 */
export function computeDaysSinceTrained(
  entries: readonly MuscleTrainingEntry[],
  todayString: string
): Partial<Record<MuscleMapBodyPart, number>> {
  const lastTrained: Partial<Record<MuscleMapBodyPart, string>> = {};
  for (const entry of entries) {
    if (entry.sets.length === 0) continue; // an exercise added but never actually logged
    const date = entry.startedAt.slice(0, 10);
    const parts = new Set<MuscleMapBodyPart>(MUSCLE_GROUP_TO_BODY_PARTS[entry.muscleGroup] ?? []);
    for (const raw of entry.secondaryMuscles) {
      for (const part of SECONDARY_MUSCLE_TO_BODY_PARTS[raw] ?? []) parts.add(part);
    }
    for (const part of parts) {
      const current = lastTrained[part];
      if (!current || date > current) lastTrained[part] = date;
    }
  }
  const days: Partial<Record<MuscleMapBodyPart, number>> = {};
  for (const part of ALL_DRAWABLE_BODY_PARTS) {
    const last = lastTrained[part];
    if (last) days[part] = daysBetween(last, todayString);
  }
  return days;
}

export type MuscleVolumeWindow = 'week' | '30d' | '90d' | 'all';

/** The inclusive lower-bound date (YYYY-MM-DD) computeMuscleVolume should use for a given Stats
 * screen window selector — 'week' is the current Mon-Sun week (not a rolling 7 days), matching
 * computeWeekStreak's own week definition; 'all' has no lower bound. */
export function windowSinceDate(window: MuscleVolumeWindow, todayString: string): string | null {
  if (window === 'all') return null;
  if (window === 'week') return getWeekBoundsForDateString(todayString).weekStart;
  const days = window === '30d' ? 30 : 90;
  const [y, m, d] = todayString.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export type FatigueState = 'fatigued' | 'recovering' | 'ready';

/**
 * Fatigue thresholds — a deliberately simple heuristic, not a real recovery model: most muscles
 * regain their baseline readiness within roughly 48-72h of a hard session, so under 2 days is
 * still Fatigued, 2-4 days is Recovering, 4+ days (or never trained) is Ready. Matches the
 * Fatigued/Recovering/Ready legend on the Fatiga diagram.
 */
export function classifyFatigue(daysSinceTrained: number | undefined): FatigueState {
  if (daysSinceTrained === undefined) return 'ready';
  if (daysSinceTrained < 2) return 'fatigued';
  if (daysSinceTrained < 4) return 'recovering';
  return 'ready';
}
