import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { WORKOUT_ACTIVITY_URL } from '@/lib/domain/workoutActivity';
import type { LiveActivityContent } from '@/lib/domain/liveActivityContent';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

interface ActivityInstance {
  update(props: LiveActivityContent): Promise<void>;
  end(dismissalPolicy?: 'default' | 'immediate'): Promise<void>;
}

interface ActivityFactory {
  start(props: LiveActivityContent, url?: string): ActivityInstance;
  getInstances(): ActivityInstance[];
}

/**
 * The Live Activity needs native code that only exists in a build made after expo-widgets was
 * added — an older binary (or Expo Go, or Android) simply has no such module. Loading the widget
 * file registers it with the native side, and that can throw there, so it is `require`d lazily
 * and only on iOS outside Expo Go; anywhere else this whole feature quietly does nothing.
 */
function loadFactory(): ActivityFactory | null {
  if (Platform.OS !== 'ios' || isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see doc comment above
    return require('./WorkoutActivity').default;
  } catch {
    return null;
  }
}

// Calls are chained so two syncs fired back to back (a foreground event right after a check-in)
// can never both see "no activity yet" and start two of them.
let queue: Promise<void> = Promise.resolve();

// Which `kind` the currently-running activity (if any) was actually STARTED with — not just what
// its last-pushed content says. Persisted (not a plain module variable) so it survives the app
// being killed and relaunched while a Live Activity is still running on the Lock Screen; without
// that, every relaunch would misread "no record of it" as a kind change and restart the activity
// for nothing. See apply() below for why this matters: LiveActivityFactory.start()'s own `url`
// param (what "tap anywhere on the activity" opens — WorkoutActivity.tsx's individual Link buttons
// are separate and always correct) can only be set once, at creation; LiveActivity.update() takes
// only props + staleDate (confirmed against expo-widgets' own source), with no way to change it.
// Going from a checkout-pending activity to a routine one (or back) via update() alone would keep
// the OLD tap-anywhere destination forever, even though the visible content — and its own button —
// already correctly switched.
export const ACTIVE_KIND_CACHE_KEY = 'gymbuddies:live-activity-kind';

async function apply(content: LiveActivityContent | null): Promise<void> {
  const factory = loadFactory();
  if (!factory) return;
  try {
    const [current, ...extra] = factory.getInstances();
    await Promise.all(extra.map((instance) => instance.end('immediate')));
    if (!content) {
      if (current) await current.end('immediate');
      await AsyncStorage.removeItem(ACTIVE_KIND_CACHE_KEY);
      return;
    }
    const startedKind = current ? await AsyncStorage.getItem(ACTIVE_KIND_CACHE_KEY) : null;
    if (current && startedKind === content.kind) {
      await current.update(content);
    } else {
      // No activity yet, or one exists but was started for the OTHER kind — a fresh instance is
      // the only way to also fix its tap-anywhere URL, not just its visible content.
      if (current) await current.end('immediate');
      factory.start(content, content.kind === 'routine' ? content.openUrl : WORKOUT_ACTIVITY_URL);
      await AsyncStorage.setItem(ACTIVE_KIND_CACHE_KEY, content.kind);
    }
  } catch (error) {
    // Live Activities can be switched off in iOS Settings, or refused by the system —
    // never let that get in the way of the check-in itself.
    console.warn('[liveActivity] could not sync the workout activity', error);
  }
}

/**
 * Makes the lock-screen widget match `content` — the checkout timer, an in-progress routine, or
 * (when `content` is null) none — starting it, refreshing it, or ending it as needed. Safe to call
 * as often as you like (it is idempotent) and it never throws.
 */
export function syncWorkoutLiveActivity(content: LiveActivityContent | null): Promise<void> {
  queue = queue.then(() => apply(content));
  return queue;
}
