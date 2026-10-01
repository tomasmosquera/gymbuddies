import { groupRoutinesByProgram } from '@/lib/domain/routinePrograms';
import type { Routine } from '@/lib/supabase/types';

const routine = (overrides: Partial<Routine> & { name: string }): Routine => ({
  id: overrides.name,
  owner_user_id: 'admin',
  group_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_official: true,
  level: null,
  goal: null,
  days_per_week: null,
  program_name: null,
  day_label: null,
  program_order: null,
  ...overrides,
});

describe('groupRoutinesByProgram', () => {
  it('groups routines sharing a program_name, ordered by program_order', () => {
    const push = routine({ name: 'PPL - Push', program_name: 'Push Pull Legs', day_label: 'Push', program_order: 1 });
    const legs = routine({ name: 'PPL - Legs', program_name: 'Push Pull Legs', day_label: 'Legs', program_order: 3 });
    const pull = routine({ name: 'PPL - Pull', program_name: 'Push Pull Legs', day_label: 'Pull', program_order: 2 });

    const groups = groupRoutinesByProgram([legs, push, pull]); // deliberately out of order
    expect(groups).toHaveLength(1);
    expect(groups[0].programName).toBe('Push Pull Legs');
    expect(groups[0].routines.map((r) => r.day_label)).toEqual(['Push', 'Pull', 'Legs']);
  });

  it('treats a routine with no program_name as its own standalone group', () => {
    const solo = routine({ name: 'Full Body Sin Equipo' });
    const groups = groupRoutinesByProgram([solo]);
    expect(groups).toEqual([{ programName: null, routines: [solo] }]);
  });

  it('keeps separate programs separate, and sorts groups by program name (or the lone routine name) in Spanish order', () => {
    const upperLower = routine({ name: 'Upper Lower - Tren Superior', program_name: 'Upper Lower', program_order: 1 });
    const strongLifts = routine({ name: 'StrongLifts 5x5 - Dia A', program_name: 'StrongLifts 5x5', program_order: 1 });
    const soloA = routine({ name: 'Aventura Solitaria' });

    const groups = groupRoutinesByProgram([upperLower, strongLifts, soloA]);
    expect(groups.map((g) => g.programName ?? g.routines[0].name)).toEqual([
      'Aventura Solitaria',
      'StrongLifts 5x5',
      'Upper Lower',
    ]);
  });

  it('returns an empty list for no routines', () => {
    expect(groupRoutinesByProgram([])).toEqual([]);
  });
});
