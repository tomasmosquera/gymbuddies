import type { MuscleGroup } from '@/lib/supabase/types';

/**
 * Every MuscleGroup with an actual drawable region on the body diagram —
 * 'cardio' and 'full_body' have no single body part to highlight, so the
 * diagram treats them specially instead (full_body lights up all of these
 * at once; cardio shows only as a chip).
 */
export const DRAWABLE_MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'core',
];

const DISPLAY_ORDER: MuscleGroup[] = [...DRAWABLE_MUSCLE_GROUPS, 'cardio', 'full_body'];

/**
 * Dedups a routine's exercises down to the distinct primary muscle groups
 * they train, in a stable display order — insertion order (whatever order
 * the exercises happen to be in) would jitter the chip list across edits
 * for no real reason.
 */
export function collectRoutineMuscleGroups(primaryMuscleGroups: readonly MuscleGroup[]): MuscleGroup[] {
  const present = new Set(primaryMuscleGroups);
  return DISPLAY_ORDER.filter((g) => present.has(g));
}
