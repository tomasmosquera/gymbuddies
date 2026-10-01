import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { WORKOUT_ACTIVITY_URL } from '@/lib/domain/workoutActivity';
import type { LiveActivityContent } from '@/lib/domain/liveActivityContent';
import { recordLiveActivityAttempt } from './liveActivityDebug';

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

async function apply(content: LiveActivityContent | null): Promise<void> {
  const contentKind = content?.kind ?? 'none';
  const factory = loadFactory();
  if (!factory) {
    await recordLiveActivityAttempt({
      at: new Date().toISOString(),
      moduleLoaded: false,
      existingInstances: 0,
      contentKind,
      content,
      action: 'none',
      outcome: 'ok',
    });
    return;
  }
  try {
    const [current, ...extra] = factory.getInstances();
    const existingInstances = (current ? 1 : 0) + extra.length;
    const action: 'start' | 'update' | 'end' | 'none' = !content ? (current ? 'end' : 'none') : current ? 'update' : 'start';
    // Written BEFORE the native call below, not just after — see liveActivityDebug.ts's doc
    // comment for why: a native exception thrown inside that call can abort the whole process
    // without ever reaching the catch block beneath it.
    await recordLiveActivityAttempt({ at: new Date().toISOString(), moduleLoaded: true, existingInstances, contentKind, content, action, outcome: 'pending' });

    await Promise.all(extra.map((instance) => instance.end('immediate')));
    if (!content) {
      if (current) await current.end('immediate');
    } else if (current) {
      await current.update(content);
    } else {
      factory.start(content, content.kind === 'routine' ? content.openUrl : WORKOUT_ACTIVITY_URL);
    }
    await recordLiveActivityAttempt({ at: new Date().toISOString(), moduleLoaded: true, existingInstances, contentKind, content, action, outcome: 'ok' });
  } catch (error) {
    await recordLiveActivityAttempt({
      at: new Date().toISOString(),
      moduleLoaded: true,
      existingInstances: -1,
      contentKind,
      content,
      action: 'none',
      outcome: 'error',
      error: String(error),
    });
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

/**
 * Temporary diagnostic action (see liveActivityDebug.ts) — ends every Live Activity instance this
 * app currently has, regardless of content. Exists because a device diagnostic showed
 * syncWorkoutLiveActivity finding an instance already running (existingInstances: 1, from before
 * this debug build was even installed) and successfully `update()`-ing it every time, yet nothing
 * ever appears on screen — consistent with that instance being stuck in a broken render from
 * whenever it first started, with every later update() only ever refreshing its (invisible)
 * content, never its rendering. This forces a clean slate so the next sync starts a brand new one.
 * Remove alongside the rest of the debug scaffolding once the real bug is found.
 */
export async function forceEndAllLiveActivities(): Promise<{ ended: number } | { error: string }> {
  const factory = loadFactory();
  if (!factory) return { ended: 0 };
  try {
    const instances = factory.getInstances();
    await Promise.all(instances.map((instance) => instance.end('immediate')));
    return { ended: instances.length };
  } catch (error) {
    return { error: String(error) };
  }
}
