import { percentileAmong } from './personalStatsV2';
import type { MuscleGroup } from '@/lib/supabase/types';

/** The 7 axes requested for the Comparar tab's muscle radar — coarser than MuscleGroup (quads/hamstrings/glutes/calves all fold into "legs"), and deliberately leaves out forearms/cardio/full_body: those weren't asked for, and forcing them into the nearest bucket would misrepresent what's actually being trained. */
export type MuscleBucket = 'back' | 'chest' | 'shoulders' | 'biceps' | 'triceps' | 'legs' | 'core';

export const MUSCLE_BUCKET_ORDER: MuscleBucket[] = ['back', 'chest', 'shoulders', 'biceps', 'triceps', 'legs', 'core'];

export const MUSCLE_BUCKET_LABELS: Record<MuscleBucket, string> = {
  back: 'Espalda',
  chest: 'Pecho',
  shoulders: 'Hombros',
  biceps: 'Biceps',
  triceps: 'Triceps',
  legs: 'Piernas',
  core: 'Core',
};

/** An exercise's own `muscle_group` (our enum) -> bucket. Entries missing here (forearms, cardio, full_body) contribute nothing as a PRIMARY muscle — full_body exercises still count via whatever real secondary_muscles they list. */
const PRIMARY_TO_BUCKET: Partial<Record<MuscleGroup, MuscleBucket>> = {
  back: 'back',
  chest: 'chest',
  shoulders: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  core: 'core',
};

/**
 * `secondary_muscles` is free English text from the WorkoutX import (see
 * migrations 0131/0144-0151), not our own MuscleGroup enum — every distinct
 * value actually present in the exercises table as of 2026-09-29 is mapped
 * here. Anything genuinely outside these 7 axes (Forearms, Grip Muscles,
 * Wrist Flexors, Ankle Stabilizers/Ankles, Cardiovascular System) is left
 * unmapped on purpose and simply contributes nothing, rather than being
 * forced into the nearest bucket.
 */
const SECONDARY_TO_BUCKET: Record<string, MuscleBucket> = {
  Abs: 'core',
  Core: 'core',
  Obliques: 'core',
  Adductors: 'legs',
  Calves: 'legs',
  Glutes: 'legs',
  Hamstrings: 'legs',
  'Hip Flexors': 'legs',
  Quadriceps: 'legs',
  Quads: 'legs',
  Soleus: 'legs',
  Back: 'back',
  'Latissimus Dorsi': 'back',
  Lats: 'back',
  'Lower Back': 'back',
  Rhomboids: 'back',
  Spine: 'back',
  Trapezius: 'back',
  Traps: 'back',
  'Upper Back': 'back',
  Chest: 'chest',
  Pectorals: 'chest',
  'Upper Chest': 'chest',
  Deltoids: 'shoulders',
  Delts: 'shoulders',
  'Rear Deltoids': 'shoulders',
  'Rotator Cuff': 'shoulders',
  Shoulders: 'shoulders',
  Biceps: 'biceps',
  Brachialis: 'biceps',
  Triceps: 'triceps',
};

export interface MuscleDistributionEntry {
  muscleGroup: MuscleGroup;
  secondaryMuscles: readonly string[];
  /** Only whether each set is a warmup matters here — how much was lifted doesn't, this is about training frequency/emphasis, not strength. */
  sets: readonly { isWarmup: boolean }[];
}

const PRIMARY_WEIGHT = 1;
const SECONDARY_WEIGHT = 0.5;

/**
 * Real (non-warmup) set counts per bucket across someone's full history —
 * "how much they train each body part", not how heavy. Each real set
 * credits its exercise's primary muscle bucket in full, and each of its
 * (mapped) secondary muscles at half weight — a set of Bench Press counts
 * fully toward Pecho and half toward Hombros/Triceps, matching how apps
 * like Hevy/Strong weight secondary engagement. A single exercise never
 * double-counts the same bucket twice even if two of its secondary muscles
 * both map to it (e.g. "Quads" and "Glutes" both -> legs).
 */
export function computeMuscleBucketCounts(entries: readonly MuscleDistributionEntry[]): Record<MuscleBucket, number> {
  const counts: Record<MuscleBucket, number> = { back: 0, chest: 0, shoulders: 0, biceps: 0, triceps: 0, legs: 0, core: 0 };
  for (const entry of entries) {
    const realSetCount = entry.sets.filter((s) => !s.isWarmup).length;
    if (realSetCount === 0) continue;

    const primaryBucket = PRIMARY_TO_BUCKET[entry.muscleGroup];
    if (primaryBucket) counts[primaryBucket] += realSetCount * PRIMARY_WEIGHT;

    const secondaryBuckets = new Set(
      entry.secondaryMuscles.map((m) => SECONDARY_TO_BUCKET[m]).filter((b): b is MuscleBucket => b !== undefined)
    );
    for (const bucket of secondaryBuckets) {
      if (bucket === primaryBucket) continue; // already got full credit above
      counts[bucket] += realSetCount * SECONDARY_WEIGHT;
    }
  }
  return counts;
}

export type MuscleRadarScaleMode = 'ownShare' | 'groupPercentile' | 'absolute';

/**
 * Mode A — "% de tu propio entreno": each axis is this person's OWN share of
 * their OWN total training (always sums to 100 across the 7 axes). Shows
 * internal balance/emphasis — which muscles THIS person prioritizes —
 * completely independent of how much the other person trains in total, so
 * two people with wildly different total volume can still show similarly
 * "balanced" (or similarly lopsided) shapes.
 */
export function computeMuscleShareRadar(counts: Record<MuscleBucket, number>): number[] {
  const total = MUSCLE_BUCKET_ORDER.reduce((sum, b) => sum + counts[b], 0);
  if (total === 0) return MUSCLE_BUCKET_ORDER.map(() => 0);
  return MUSCLE_BUCKET_ORDER.map((b) => (counts[b] / total) * 100);
}

/**
 * Mode B — "Percentil contra el grupo": each axis ranks this person against
 * everyone ELSE on the roster (not just the one compared teammate) for that
 * muscle — the same "beat N% of the group" idea personalStatsV2's
 * percentileAmong already provides, just per muscle bucket instead of per
 * overall stat. `others` is every other roster member's counts (the caller
 * excludes the person being ranked). A group of 1 (nobody else) returns 50
 * for every axis — neither strong nor weak, undefined.
 */
export function computeMuscleGroupPercentileRadar(mine: Record<MuscleBucket, number>, others: Record<MuscleBucket, number>[]): number[] {
  if (others.length === 0) return MUSCLE_BUCKET_ORDER.map(() => 50);
  return MUSCLE_BUCKET_ORDER.map((b) => percentileAmong(mine[b], others.map((o) => o[b])) ?? 50);
}

/**
 * Mode C — "Escala absoluta compartida": every axis shares ONE scale
 * (`sharedMax`, e.g. the largest count seen across both compared people's
 * every bucket) instead of each axis independently stretching to fill the
 * chart — a real imbalance (legs trained far more than arms, say) shows up
 * as genuinely different-sized spokes instead of every axis looking equally
 * "full".
 */
export function computeMuscleAbsoluteRadar(counts: Record<MuscleBucket, number>, sharedMax: number): number[] {
  const max = Math.max(sharedMax, 1);
  return MUSCLE_BUCKET_ORDER.map((b) => (counts[b] / max) * 100);
}
