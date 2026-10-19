import { useWorkoutHistory, type WorkoutHistorySession } from '@/hooks/useWorkoutHistory';
import { computeWeekStreak } from '@/lib/domain/workoutStreak';

export interface WorkoutStatsSummary {
  totalWorkouts: number;
  thisMonthWorkouts: number;
  weekStreak: number;
  /** Every completed session, newest first — callers slice however many they want to show. */
  allWorkouts: WorkoutHistorySession[];
  isLoading: boolean;
}

/** Shared by the compact "Rutinas y ejercicios" card on the main Stats screen and the full
 * exercise-stats detail screen, so both read the exact same totals instead of two separate
 * computations drifting apart. */
export function useWorkoutStatsSummary(): WorkoutStatsSummary {
  const { sessions, isLoading } = useWorkoutHistory();
  const todayString = new Date().toISOString().slice(0, 10);
  const totalWorkouts = sessions.length;
  const thisMonthWorkouts = sessions.filter((s) => s.startedAt.slice(0, 7) === todayString.slice(0, 7)).length;
  const weekStreak = computeWeekStreak(
    sessions.map((s) => s.startedAt.slice(0, 10)),
    todayString
  );
  return { totalWorkouts, thisMonthWorkouts, weekStreak, allWorkouts: sessions, isLoading };
}
