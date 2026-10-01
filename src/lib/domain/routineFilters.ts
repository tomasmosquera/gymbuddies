import type { RoutineGoal, RoutineLevel } from '@/lib/supabase/types';

export type RoutineEquipmentProfile = 'sin_equipo' | 'mancuernas' | 'gimnasio';

/**
 * What a routine needs, in one of three buckets a member can filter by — never stored on the
 * routine itself (so it can't drift from the exercises actually in it): derived straight from the
 * `equipment` column of whichever exercises make it up. Bodyweight-only is the "sin equipo" case;
 * bodyweight plus dumbbell (a routine mixing push-ups with dumbbell work, say) still counts as
 * "mancuernas" since nothing beyond a pair of dumbbells is required; anything else (barbell,
 * machine, cable, kettlebell, band, smith_machine, or a mix including one of those) needs a real gym.
 */
export function deriveEquipmentProfile(equipmentValues: readonly string[]): RoutineEquipmentProfile {
  const unique = new Set(equipmentValues);
  if (unique.size === 0) return 'gimnasio';
  if ([...unique].every((e) => e === 'bodyweight')) return 'sin_equipo';
  if ([...unique].every((e) => e === 'bodyweight' || e === 'dumbbell')) return 'mancuernas';
  return 'gimnasio';
}

export const ROUTINE_LEVEL_LABELS: Record<RoutineLevel, string> = {
  principiante: 'Principiante',
  intermedio: 'Intermedio',
  avanzado: 'Avanzado',
};

export const ROUTINE_GOAL_LABELS: Record<RoutineGoal, string> = {
  fuerza: 'Fuerza',
  hipertrofia: 'Hipertrofia',
  perdida_grasa: 'Pérdida de grasa',
  general: 'General',
};

export const ROUTINE_EQUIPMENT_LABELS: Record<RoutineEquipmentProfile, string> = {
  sin_equipo: 'Sin equipo',
  mancuernas: 'Solo mancuernas',
  gimnasio: 'Gimnasio completo',
};

export interface RoutineFilterState {
  level: RoutineLevel | null;
  goal: RoutineGoal | null;
  equipment: RoutineEquipmentProfile | null;
}

export const EMPTY_ROUTINE_FILTERS: RoutineFilterState = { level: null, goal: null, equipment: null };

export interface FilterableRoutine {
  level: RoutineLevel | null;
  goal: RoutineGoal | null;
  equipmentProfile: RoutineEquipmentProfile;
}

/** A null filter field means "any" — only fields the member actually picked narrow the list. */
export function matchesRoutineFilters(routine: FilterableRoutine, filters: RoutineFilterState): boolean {
  if (filters.level !== null && routine.level !== filters.level) return false;
  if (filters.goal !== null && routine.goal !== filters.goal) return false;
  if (filters.equipment !== null && routine.equipmentProfile !== filters.equipment) return false;
  return true;
}
