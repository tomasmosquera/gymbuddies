import type { Equipment } from '@/lib/supabase/types';

/** Display order doubles as the filter-chip order in the exercise picker. */
export const EQUIPMENT_ORDER: Equipment[] = [
  'barbell', 'dumbbell', 'machine', 'cable', 'smith_machine', 'kettlebell', 'band', 'bodyweight', 'other',
];

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barra',
  dumbbell: 'Mancuerna',
  machine: 'Máquina',
  cable: 'Polea',
  smith_machine: 'Multipower',
  kettlebell: 'Kettlebell',
  band: 'Banda',
  bodyweight: 'Peso corporal',
  other: 'Otro',
};
