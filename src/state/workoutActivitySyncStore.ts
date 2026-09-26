import { create } from 'zustand';

interface WorkoutActivitySyncState {
  /** Bumped whenever something changes a check-in on this device — useWorkoutLiveActivity re-syncs on every change. */
  version: number;
  requestSync: () => void;
}

export const useWorkoutActivitySyncStore = create<WorkoutActivitySyncState>((set) => ({
  version: 0,
  requestSync: () => set((s) => ({ version: s.version + 1 })),
}));

/** Call after a check-in / final photo is saved or a check-in is deleted, so the lock-screen timer follows. */
export function requestWorkoutActivitySync(): void {
  useWorkoutActivitySyncStore.getState().requestSync();
}
