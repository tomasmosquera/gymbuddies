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

export interface MuscleDistributionRadar {
  mine: number[];
  theirs: number[];
}

/**
 * Head-to-head radar values (0-100 each, aligned with MUSCLE_BUCKET_ORDER) —
 * each axis independently scaled to whichever of the two people trains that
 * muscle more, so the "winner" of an axis always reaches the outer edge and
 * the other shows their share relative to that. Deliberately NOT a group
 * percentile (unlike the old member-comparison radar) — Comparar is already
 * a two-person view, there's no group-wide pool to rank against here.
 */
export function computeMuscleDistributionRadar(
  mine: Record<MuscleBucket, number>,
  theirs: Record<MuscleBucket, number>
): MuscleDistributionRadar {
  const mineValues: number[] = [];
  const theirsValues: number[] = [];
  for (const bucket of MUSCLE_BUCKET_ORDER) {
    const max = Math.max(mine[bucket], theirs[bucket], 1);
    mineValues.push((mine[bucket] / max) * 100);
    theirsValues.push((theirs[bucket] / max) * 100);
  }
  return { mine: mineValues, theirs: theirsValues };
}
