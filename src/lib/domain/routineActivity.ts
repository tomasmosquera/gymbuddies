/** Opens the workout-session screen straight up — the routine-mode Live Activity/Dynamic Island's own version of workoutActivity.ts's WORKOUT_ACTIVITY_URL. */
export const ROUTINE_ACTIVITY_OPEN_URL = 'gymbuddies://profile/workout-session';

/** Same screen, plus a param workout-session.tsx reads once on arrival to skip the current rest period automatically — no extra tap once the app opens (see that screen's own doc comment on where this is consumed). */
export const ROUTINE_ACTIVITY_SKIP_REST_URL = 'gymbuddies://profile/workout-session?skipRest=1';

/** What the Live Activity renders while a routine is in progress — plain data, so it can cross into the widget's isolated runtime, same reasoning as WorkoutActivityProps. */
export interface RoutineActivityProps {
  /** "Entreno libre" for a freeform session (routine_name_snapshot is null). */
  routineName: string;
  /** ISO instant the session started — the elapsed-time count-up's lower bound. */
  startedAt: string;
  /** Every real workout_sets row logged so far, across every exercise in the session. */
  completedSets: number;
  /** Sum of each exercise's target_sets_snapshot length — 0 for an all-freeform session with no planned sets at all (the widget hides the progress bar in that case). */
  totalSets: number;
  /** ISO instant the current rest period ends, or null when not currently resting. Drives which of the two button/timer states the widget shows. */
  restEndAt: string | null;
  openUrl: string;
  skipRestUrl: string;
}

export interface RoutineSessionExerciseLike {
  target_sets_snapshot: readonly unknown[];
  sets: readonly unknown[];
}

export interface RoutineSessionLike {
  started_at: string;
  routine_name_snapshot: string | null;
  exercises: readonly RoutineSessionExerciseLike[];
}

/**
 * Builds the routine-mode Live Activity props from an in-progress session —
 * called every time something about it changes (a set logged, an exercise
 * added/removed, rest started/ended) so the widget's own props always
 * reflect true completedSets/totalSets/restEndAt, not just its visual
 * countdown (which the system ticks on its own between updates).
 */
export function routineActivityForSession(session: RoutineSessionLike, restEndAtMs: number | null): RoutineActivityProps {
  let completedSets = 0;
  let totalSets = 0;
  for (const exercise of session.exercises) {
    completedSets += exercise.sets.length;
    totalSets += exercise.target_sets_snapshot.length;
  }
  return {
    routineName: session.routine_name_snapshot ?? 'Entreno libre',
    startedAt: session.started_at,
    completedSets,
    totalSets,
    restEndAt: restEndAtMs !== null ? new Date(restEndAtMs).toISOString() : null,
    openUrl: ROUTINE_ACTIVITY_OPEN_URL,
    skipRestUrl: ROUTINE_ACTIVITY_SKIP_REST_URL,
  };
}
