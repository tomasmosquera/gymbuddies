import type { RoutineExerciseFormRow } from '@/components/ui/RoutineExerciseListEditor';
import type { RoutineExerciseInput } from '@/lib/validation/schemas';
import type { RoutineExerciseArg, RoutineExerciseSet } from '@/lib/supabase/types';
import { kgToUnit, type WeightUnit } from '@/lib/domain/workoutUnits';

/** An already-saved routine exercise (+ its planned sets) -> editable form state, weight shown in `unit` (its own unit isn't stored — only canonical kg is — so editing always starts from the member's current preference; they can still flip it per exercise from there). */
export function routineExerciseToFormRow(
  input: { exercise_id: string; exercise_name: string; rest_seconds: number | null; notes: string | null; sets: RoutineExerciseSet[] },
  unit: WeightUnit
): RoutineExerciseFormRow {
  const restSeconds = input.rest_seconds ?? 0;
  return {
    exerciseId: input.exercise_id,
    exerciseName: input.exercise_name,
    unit,
    restMinutes: restSeconds > 0 ? String(Math.floor(restSeconds / 60)) : '',
    restSeconds: restSeconds > 0 ? String(restSeconds % 60) : '',
    notes: input.notes ?? '',
    sets: input.sets.map((s) => ({
      targetReps: String(s.target_reps),
      targetWeight: s.target_weight_kg !== null ? String(kgToUnit(s.target_weight_kg, unit)) : '',
      isFailureTarget: s.is_failure_target,
    })),
  };
}

/** Raw form state (strings, minutes+seconds kept apart) -> the shape routineSchema validates. Pure so it's testable without React. */
export function formRowsToRoutineInput(rows: RoutineExerciseFormRow[]): {
  exerciseId: string;
  restSeconds: number | undefined;
  notes: string;
  unit: WeightUnit;
  sets: { targetReps: number; targetWeight: number | undefined; isFailureTarget: boolean }[];
}[] {
  return rows.map((row) => {
    const totalRestSeconds = (Number(row.restMinutes) || 0) * 60 + (Number(row.restSeconds) || 0);
    return {
      exerciseId: row.exerciseId,
      restSeconds: totalRestSeconds > 0 ? totalRestSeconds : undefined,
      notes: row.notes,
      unit: row.unit,
      sets: row.sets.map((s) => ({
        targetReps: Number(s.targetReps) || 0,
        targetWeight: s.targetWeight ? Number(s.targetWeight) : undefined,
        isFailureTarget: s.isFailureTarget,
      })),
    };
  });
}

/** Validated form data -> what create_routine/update_routine take — each exercise carries its own unit. */
export function routineInputToArgs(exercises: RoutineExerciseInput[]): RoutineExerciseArg[] {
  return exercises.map((e) => ({
    exercise_id: e.exerciseId,
    rest_seconds: e.restSeconds ?? null,
    notes: e.notes || null,
    unit: e.unit,
    sets: e.sets.map((s) => ({ target_reps: s.targetReps, target_weight: s.targetWeight, is_failure_target: s.isFailureTarget })),
  }));
}
