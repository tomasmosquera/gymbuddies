import { create } from 'zustand';

interface RestTimerState {
  /** ms epoch the current rest period ends, or null when not resting. useRestTimer (mounted only while workout-session.tsx is open) is the sole writer; useWorkoutLiveActivity reads it (via getState(), not the hook) when reconciling so the routine Live Activity can show a live rest countdown even though the countdown's own state otherwise lives entirely in that screen's local refs. */
  endAt: number | null;
}

export const useRestTimerStore = create<RestTimerState>(() => ({ endAt: null }));

export function setRestTimerEndAt(endAt: number | null): void {
  useRestTimerStore.setState({ endAt });
}
