import { deriveEquipmentProfile, matchesRoutineFilters, type FilterableRoutine } from '@/lib/domain/routineFilters';

describe('deriveEquipmentProfile', () => {
  it('is "sin_equipo" when every exercise is bodyweight', () => {
    expect(deriveEquipmentProfile(['bodyweight', 'bodyweight'])).toBe('sin_equipo');
  });

  it('is "mancuernas" for dumbbell-only, and for dumbbell mixed with bodyweight', () => {
    expect(deriveEquipmentProfile(['dumbbell', 'dumbbell'])).toBe('mancuernas');
    expect(deriveEquipmentProfile(['dumbbell', 'bodyweight'])).toBe('mancuernas');
  });

  it('is "gimnasio" as soon as anything else is involved', () => {
    expect(deriveEquipmentProfile(['barbell', 'dumbbell'])).toBe('gimnasio');
    expect(deriveEquipmentProfile(['machine'])).toBe('gimnasio');
    expect(deriveEquipmentProfile(['kettlebell', 'bodyweight'])).toBe('gimnasio');
  });

  it('defaults to "gimnasio" for an empty list (never actually happens — a routine always has exercises)', () => {
    expect(deriveEquipmentProfile([])).toBe('gimnasio');
  });
});

describe('matchesRoutineFilters', () => {
  const routine = (overrides: Partial<FilterableRoutine> = {}): FilterableRoutine => ({
    level: 'intermedio',
    goal: 'hipertrofia',
    equipmentProfile: 'gimnasio',
    ...overrides,
  });

  it('matches everything when every filter is "any" (null)', () => {
    expect(matchesRoutineFilters(routine(), { level: null, goal: null, equipment: null })).toBe(true);
  });

  it('narrows by whichever filters are actually set', () => {
    expect(matchesRoutineFilters(routine(), { level: 'intermedio', goal: null, equipment: null })).toBe(true);
    expect(matchesRoutineFilters(routine(), { level: 'principiante', goal: null, equipment: null })).toBe(false);
    expect(matchesRoutineFilters(routine(), { level: null, goal: 'fuerza', equipment: null })).toBe(false);
    expect(matchesRoutineFilters(routine(), { level: null, goal: null, equipment: 'sin_equipo' })).toBe(false);
  });

  it('requires every set filter to match at once', () => {
    const filters = { level: 'intermedio' as const, goal: 'hipertrofia' as const, equipment: 'gimnasio' as const };
    expect(matchesRoutineFilters(routine(), filters)).toBe(true);
    expect(matchesRoutineFilters(routine({ goal: 'fuerza' }), filters)).toBe(false);
  });
});
