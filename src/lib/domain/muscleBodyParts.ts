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
 * Which drawable body parts should be shaded for a routine's (or a single exercise's)
 * primary muscle groups — 'full_body' lights up every drawable part at once, since there's
 * no single region that represents it.
 */
export function bodyPartsToHighlight(muscleGroups: readonly MuscleGroup[]): Set<MuscleMapBodyPart> {
  if (muscleGroups.includes('full_body')) return new Set(ALL_DRAWABLE_BODY_PARTS);
  const parts = new Set<MuscleMapBodyPart>();
  for (const group of muscleGroups) {
    for (const part of MUSCLE_GROUP_TO_BODY_PARTS[group] ?? []) parts.add(part);
  }
  return parts;
}
