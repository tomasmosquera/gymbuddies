import {
  ROUTINE_ACTIVITY_OPEN_URL,
  ROUTINE_ACTIVITY_SKIP_REST_URL,
  routineActivityForSession,
  type RoutineSessionLike,
} from '@/lib/domain/routineActivity';

const START = '2026-09-30T15:00:00Z';

const exercise = (targetSets: number, loggedSets: number) => ({
  target_sets_snapshot: Array.from({ length: targetSets }),
  sets: Array.from({ length: loggedSets }),
});

const session = (overrides: Partial<RoutineSessionLike> = {}): RoutineSessionLike => ({
  started_at: START,
  routine_name_snapshot: 'Empuje',
  exercises: [exercise(4, 2), exercise(3, 0)],
  ...overrides,
});

describe('routineActivityForSession', () => {
  it('carries the routine name, start time and the two deep links', () => {
    const props = routineActivityForSession(session(), null);
    expect(props.routineName).toBe('Empuje');
    expect(props.startedAt).toBe(START);
    expect(props.openUrl).toBe(ROUTINE_ACTIVITY_OPEN_URL);
    expect(props.skipRestUrl).toBe(ROUTINE_ACTIVITY_SKIP_REST_URL);
  });

  it('falls back to "Entreno libre" for a freeform session (no routine snapshot)', () => {
    expect(routineActivityForSession(session({ routine_name_snapshot: null }), null).routineName).toBe('Entreno libre');
  });

  it('sums completed and total sets across every exercise', () => {
    const props = routineActivityForSession(session(), null);
    expect(props.completedSets).toBe(2);
    expect(props.totalSets).toBe(7);
  });

  it('is 0/0 for an all-freeform session with no planned sets at all', () => {
    const props = routineActivityForSession(session({ exercises: [] }), null);
    expect(props.completedSets).toBe(0);
    expect(props.totalSets).toBe(0);
  });

  it('carries no rest end time when not resting', () => {
    expect(routineActivityForSession(session(), null).restEndAt).toBeNull();
  });

  it('converts a rest end timestamp (ms) into an ISO instant', () => {
    const endMs = new Date(START).getTime() + 90_000;
    expect(routineActivityForSession(session(), endMs).restEndAt).toBe(new Date(endMs).toISOString());
  });
});
