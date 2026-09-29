import { formRowsToRoutineInput, routineExerciseToFormRow, routineInputToArgs } from '@/lib/domain/routineForm';
import type { RoutineExerciseFormRow } from '@/components/ui/RoutineExerciseListEditor';
import type { RoutineExerciseSet } from '@/lib/supabase/types';

const formRow = (overrides: Partial<RoutineExerciseFormRow> = {}): RoutineExerciseFormRow => ({
  exerciseId: 'ex-1',
  exerciseName: 'Bench Press (Dumbbell)',
  unit: 'kg',
  restMinutes: '',
  restSeconds: '',
  notes: '',
  sets: [{ targetRepsMin: '8', targetRepsMax: '10', targetWeight: '60', isFailureTarget: false }],
  ...overrides,
});

describe('formRowsToRoutineInput', () => {
  it('combines rest minutes + seconds into total seconds', () => {
    const [row] = formRowsToRoutineInput([formRow({ restMinutes: '2', restSeconds: '30' })]);
    expect(row.restSeconds).toBe(150);
  });

  it('leaves restSeconds undefined when no rest was set (0 total)', () => {
    const [row] = formRowsToRoutineInput([formRow({ restMinutes: '', restSeconds: '' })]);
    expect(row.restSeconds).toBeUndefined();
  });

  it('handles seconds alone (no minutes typed)', () => {
    const [row] = formRowsToRoutineInput([formRow({ restMinutes: '', restSeconds: '45' })]);
    expect(row.restSeconds).toBe(45);
  });

  it('parses each set\'s rep range, leaving weight undefined when blank (bodyweight)', () => {
    const [row] = formRowsToRoutineInput([
      formRow({ sets: [{ targetRepsMin: '8', targetRepsMax: '10', targetWeight: '', isFailureTarget: false }] }),
    ]);
    expect(row.sets).toEqual([{ targetRepsMin: 8, targetRepsMax: 10, targetWeight: undefined, isFailureTarget: false }]);
  });

  it('carries the failure-target flag through', () => {
    const [row] = formRowsToRoutineInput([
      formRow({ sets: [{ targetRepsMin: '6', targetRepsMax: '6', targetWeight: '80', isFailureTarget: true }] }),
    ]);
    expect(row.sets[0].isFailureTarget).toBe(true);
  });

  it('carries each exercise\'s own unit through, independent of the others', () => {
    const [kg, lbs] = formRowsToRoutineInput([formRow({ exerciseId: 'a', unit: 'kg' }), formRow({ exerciseId: 'b', unit: 'lbs' })]);
    expect(kg.unit).toBe('kg');
    expect(lbs.unit).toBe('lbs');
  });
});

describe('routineInputToArgs', () => {
  it('maps to the RPC arg shape (snake_case, null instead of undefined/empty)', () => {
    const args = routineInputToArgs([
      {
        exerciseId: 'ex-1',
        restSeconds: 120,
        notes: 'to failure on the last set',
        unit: 'lbs',
        sets: [{ targetRepsMin: 8, targetRepsMax: 10, targetWeight: 60, isFailureTarget: false }],
      },
    ]);
    expect(args).toEqual([
      {
        exercise_id: 'ex-1',
        rest_seconds: 120,
        notes: 'to failure on the last set',
        unit: 'lbs',
        sets: [{ target_reps_min: 8, target_reps_max: 10, target_weight: 60, is_failure_target: false }],
      },
    ]);
  });

  it('turns an empty/missing notes string into null, and a missing rest into null', () => {
    const args = routineInputToArgs([
      { exerciseId: 'ex-1', notes: '', unit: 'kg', sets: [{ targetRepsMin: 8, targetRepsMax: 8, isFailureTarget: false }] },
    ]);
    expect(args[0].notes).toBeNull();
    expect(args[0].rest_seconds).toBeNull();
  });
});

describe('routineExerciseToFormRow', () => {
  const sets: RoutineExerciseSet[] = [
    { id: 's1', routine_exercise_id: 're1', set_number: 1, target_reps_min: 8, target_reps_max: 10, target_weight_kg: 60, is_failure_target: false },
    { id: 's2', routine_exercise_id: 're1', set_number: 2, target_reps_min: 6, target_reps_max: 6, target_weight_kg: null, is_failure_target: true },
  ];

  it('splits rest_seconds back into minutes + seconds', () => {
    const row = routineExerciseToFormRow(
      { exercise_id: 'ex-1', exercise_name: 'Squat (Barbell)', rest_seconds: 150, notes: null, sets: [] },
      'kg'
    );
    expect(row.restMinutes).toBe('2');
    expect(row.restSeconds).toBe('30');
  });

  it('leaves both blank when there is no rest timer set', () => {
    const row = routineExerciseToFormRow(
      { exercise_id: 'ex-1', exercise_name: 'Squat (Barbell)', rest_seconds: null, notes: null, sets: [] },
      'kg'
    );
    expect(row.restMinutes).toBe('');
    expect(row.restSeconds).toBe('');
  });

  it('converts each set\'s weight into the display unit and keeps the rep range + failure flag', () => {
    const row = routineExerciseToFormRow(
      { exercise_id: 'ex-1', exercise_name: 'Bench Press (Dumbbell)', rest_seconds: null, notes: null, sets },
      'lbs'
    );
    expect(row.sets).toEqual([
      { targetRepsMin: '8', targetRepsMax: '10', targetWeight: '132.3', isFailureTarget: false }, // 60kg -> 132.3lbs
      { targetRepsMin: '6', targetRepsMax: '6', targetWeight: '', isFailureTarget: true },
    ]);
  });

  it('round-trips through formRowsToRoutineInput back to the same rep range/failure data', () => {
    const row = routineExerciseToFormRow(
      { exercise_id: 'ex-1', exercise_name: 'Bench Press (Dumbbell)', rest_seconds: 90, notes: 'note', sets },
      'kg'
    );
    const [input] = formRowsToRoutineInput([row]);
    expect(input.restSeconds).toBe(90);
    expect(input.sets.map((s) => [s.targetRepsMin, s.targetRepsMax, s.isFailureTarget])).toEqual([
      [8, 10, false],
      [6, 6, true],
    ]);
  });
});
