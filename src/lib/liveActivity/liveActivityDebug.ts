import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gymbuddies-live-activity-debug';

export interface LiveActivityAttempt {
  at: string;
  moduleLoaded: boolean;
  existingInstances: number;
  contentKind: 'checkout' | 'routine' | 'none';
  content: unknown;
  action: 'start' | 'update' | 'end' | 'none';
  outcome: 'pending' | 'ok' | 'error';
  error?: string;
}

/**
 * Temporary breadcrumb trail for tracking down why the Live Activity renders
 * blank on real devices (TestFlight 31-33): written BEFORE every native call
 * into expo-widgets, not only after, because a device crash report showed the
 * app aborting from an uncaught Obj-C exception thrown INSIDE one such call —
 * that crosses the bridge as a process abort, not a rejected promise, so it
 * never reaches apply()'s own try/catch in workoutLiveActivity.ts. Persisting
 * the "about to call X" state first means that even a hard crash like that
 * one leaves a readable breadcrumb once the app relaunches, instead of
 * nothing at all. Read it from Perfil (long-press the version line).
 * Delete this file and its call sites in workoutLiveActivity.ts once the
 * real bug is found — it's throwaway diagnostic scaffolding, not a feature.
 */
export async function recordLiveActivityAttempt(attempt: LiveActivityAttempt): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(attempt));
  } catch {
    // best-effort — the debug trail itself must never get in the way
  }
}

export async function getLastLiveActivityAttempt(): Promise<LiveActivityAttempt | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LiveActivityAttempt) : null;
  } catch {
    return null;
  }
}
