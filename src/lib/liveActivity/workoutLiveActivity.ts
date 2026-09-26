import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { WORKOUT_ACTIVITY_URL, type WorkoutActivityProps } from '@/lib/domain/workoutActivity';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

interface ActivityInstance {
  update(props: WorkoutActivityProps): Promise<void>;
  end(dismissalPolicy?: 'default' | 'immediate'): Promise<void>;
}

interface ActivityFactory {
  start(props: WorkoutActivityProps, url?: string): ActivityInstance;
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

async function apply(props: WorkoutActivityProps | null): Promise<void> {
  const factory = loadFactory();
  if (!factory) return;
  try {
    const [current, ...extra] = factory.getInstances();
    await Promise.all(extra.map((instance) => instance.end('immediate')));
    if (!props) {
      if (current) await current.end('immediate');
      return;
    }
    if (current) await current.update(props);
    else factory.start(props, WORKOUT_ACTIVITY_URL);
  } catch (error) {
    // Live Activities can be switched off in iOS Settings, or refused by the system —
    // never let that get in the way of the check-in itself.
    console.warn('[liveActivity] could not sync the workout activity', error);
  }
}

/**
 * Makes the lock-screen workout timer match `props`: starts it, refreshes it, or ends it when
 * `props` is null. Safe to call as often as you like (it is idempotent) and it never throws.
 */
export function syncWorkoutLiveActivity(props: WorkoutActivityProps | null): Promise<void> {
  queue = queue.then(() => apply(props));
  return queue;
}
