import type { MuscleGroup } from '@/lib/supabase/types';

/**
 * Every body-part key the MuscleMap geometry (src/components/ui/muscleMapBodyPaths.ts) can
 * draw and shade — a finer breakdown than our own 13-value MuscleGroup enum, which is why
 * some of our groups light up more than one of these at once (e.g. 'back' covers both
 * trapezius and upper/lower back, since our catalogue never tracks them separately).
 * Excludes the silhouette-only parts (neck, hands, feet, knees, ankles, head, hair), which
 * never take a highlight.
 */
export const ALL_DRAWABLE_BODY_PARTS = [
  'trapezius', 'deltoids', 'chest', 'upper-back', 'lower-back', 'serratus',
  'biceps', 'triceps', 'forearm', 'abs', 'obliques',
  'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis',
] as const;

export type MuscleMapBodyPart = (typeof ALL_DRAWABLE_BODY_PARTS)[number];

const MUSCLE_GROUP_TO_BODY_PARTS: Partial<Record<MuscleGroup, readonly MuscleMapBodyPart[]>> = {
  chest: ['chest', 'serratus'],
  back: ['trapezius', 'upper-back', 'lower-back'],
  shoulders: ['deltoids'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearm'],
  quads: ['quadriceps'],
  hamstrings: ['hamstring'],
  glutes: ['gluteal'],
  calves: ['calves'],
  core: ['abs', 'obliques'],
  // cardio has no body part — chip-only, see MuscleDiagram.tsx. full_body is handled below.
};

/**
 * `secondary_muscles` is free English text from the WorkoutX import (see migrations
 * 0131/0144-0151), not our own MuscleGroup enum — every distinct value actually present in
 * the exercises table as of 2026-10-18 is mapped here (confirmed via a live catalog query,
 * not guessed). A term can map to more than one region (e.g. "Core" also lights up
 * obliques, "Back" covers both upper and lower back). Genuinely undrawable terms (Ankles,
 * Ankle Stabilizers, Cardiovascular System) are left unmapped on purpose, same as
 * muscleDistribution.ts's SECONDARY_TO_BUCKET does for its own 7-axis radar.
 */
const SECONDARY_MUSCLE_TO_BODY_PARTS: Record<string, readonly MuscleMapBodyPart[]> = {
  Abs: ['abs'],
  Adductors: ['adductors'],
  Back: ['upper-back', 'lower-back'],
  Biceps: ['biceps'],
  Brachialis: ['biceps'],
  Calves: ['calves'],
  Chest: ['chest'],
  Core: ['abs', 'obliques'],
  Deltoids: ['deltoids'],
  Delts: ['deltoids'],
  Forearms: ['forearm'],
  Glutes: ['gluteal'],
  'Grip Muscles': ['forearm'],
  Hamstrings: ['hamstring'],
  'Hip Flexors': ['hip-flexors'],
  'Latissimus Dorsi': ['upper-back'],
  Lats: ['upper-back'],
  'Lower Back': ['lower-back'],
  Obliques: ['obliques'],
  Pectorals: ['chest'],
  Quadriceps: ['quadriceps'],
  Quads: ['quadriceps'],
  'Rear Deltoids': ['deltoids'],
  Rhomboids: ['upper-back'],
  'Rotator Cuff': ['deltoids'],
  Shoulders: ['deltoids'],
  Soleus: ['calves'],
  Spine: ['lower-back'],
  Trapezius: ['trapezius'],
  Traps: ['trapezius'],
  Triceps: ['triceps'],
  'Upper Back': ['upper-back'],
  'Upper Chest': ['chest'],
  'Wrist Flexors': ['forearm'],
};

export interface MuscleBodyHighlight {
  /** Lit up at full intensity — each exercise's own primary muscle_group. */
  primary: ReadonlySet<MuscleMapBodyPart>;
  /** Lit up at half intensity (see MuscleDiagram.tsx) — secondary_muscles, same 100%/50%
   * weighting muscleDistribution.ts already uses for the Comparar radar. Never includes a
   * part that's already primary for this same selection. */
  secondary: ReadonlySet<MuscleMapBodyPart>;
}

/**
 * Which drawable body parts should be shaded — at full intensity for each exercise's primary
 * muscle_group, at half for its secondary_muscles — for a routine's (or a single exercise's)
 * exercises. 'full_body' lights up every drawable part at full intensity on its own, since
 * there's no single region that represents it.
 */
export function bodyPartsToHighlight(
  exercises: readonly { muscleGroup: MuscleGroup; secondaryMuscles?: readonly string[] }[]
): MuscleBodyHighlight {
  const isFullBody = exercises.some((e) => e.muscleGroup === 'full_body');
  if (isFullBody) return { primary: new Set(ALL_DRAWABLE_BODY_PARTS), secondary: new Set() };

  const primary = new Set<MuscleMapBodyPart>();
  for (const { muscleGroup } of exercises) {
    for (const part of MUSCLE_GROUP_TO_BODY_PARTS[muscleGroup] ?? []) primary.add(part);
  }

  const secondary = new Set<MuscleMapBodyPart>();
  for (const { secondaryMuscles } of exercises) {
    for (const raw of secondaryMuscles ?? []) {
      for (const part of SECONDARY_MUSCLE_TO_BODY_PARTS[raw] ?? []) {
        if (!primary.has(part)) secondary.add(part);
      }
    }
  }

  return { primary, secondary };
}
