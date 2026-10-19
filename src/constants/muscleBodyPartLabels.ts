import type { MuscleMapBodyPart } from '@/lib/domain/muscleBodyParts';

/** Spanish display names for the body diagram's own ~17 regions (finer than MuscleGroup's 13 —
 * see muscleBodyParts.ts) — Stats' "Balance muscular"/"Fatiga" bar list and chips. */
export const MUSCLE_BODY_PART_LABELS: Record<MuscleMapBodyPart, string> = {
  trapezius: 'Trapecio',
  deltoids: 'Hombros',
  chest: 'Pecho',
  'upper-back': 'Espalda alta',
  'lower-back': 'Espalda baja',
  serratus: 'Serrato',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  forearm: 'Antebrazo',
  abs: 'Abdomen',
  obliques: 'Oblicuos',
  gluteal: 'Glúteos',
  quadriceps: 'Cuádriceps',
  hamstring: 'Isquiotibiales',
  adductors: 'Aductores',
  'hip-flexors': 'Flexores de cadera',
  calves: 'Pantorrillas',
  tibialis: 'Tibial',
};
