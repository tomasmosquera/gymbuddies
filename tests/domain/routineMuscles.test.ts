import { collectRoutineMuscleGroups, DRAWABLE_MUSCLE_GROUPS } from '@/lib/domain/routineMuscles';

describe('collectRoutineMuscleGroups', () => {
  it('dedups repeated muscle groups', () => {
    expect(collectRoutineMuscleGroups(['chest', 'chest', 'triceps'])).toEqual(['chest', 'triceps']);
  });

  it('orders the result by the fixed display order, not insertion order', () => {
    expect(collectRoutineMuscleGroups(['quads', 'chest', 'back'])).toEqual(['chest', 'back', 'quads']);
  });

  it('keeps cardio and full_body, after every drawable group', () => {
    expect(collectRoutineMuscleGroups(['cardio', 'chest', 'full_body'])).toEqual(['chest', 'cardio', 'full_body']);
  });

  it('returns an empty list for no exercises', () => {
    expect(collectRoutineMuscleGroups([])).toEqual([]);
  });

  it('DRAWABLE_MUSCLE_GROUPS excludes cardio and full_body', () => {
    expect(DRAWABLE_MUSCLE_GROUPS).not.toContain('cardio');
    expect(DRAWABLE_MUSCLE_GROUPS).not.toContain('full_body');
    expect(DRAWABLE_MUSCLE_GROUPS).toHaveLength(11);
  });
});
