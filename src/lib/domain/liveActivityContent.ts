import type { WorkoutActivityProps } from './workoutActivity';
import type { RoutineActivityProps } from './routineActivity';

/**
 * The one Live Activity/Dynamic Island slot this app uses can show either of two unrelated
 * things — the pending-checkout-photo timer, or an in-progress routine — never both. `kind`
 * is how the widget's isolated render function (WorkoutActivity.tsx) and the sync layer
 * (workoutLiveActivity.ts) tell which is which; useWorkoutLiveActivity.ts decides which one
 * applies right now and gives routine priority whenever both could.
 */
export type LiveActivityContent =
  | ({ kind: 'checkout' } & WorkoutActivityProps)
  | ({ kind: 'routine' } & RoutineActivityProps);
