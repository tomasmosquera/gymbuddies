import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const ACTIVE_ENERGY_BURNED = 'HKQuantityTypeIdentifierActiveEnergyBurned' as const;
const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier' as const;

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type HealthKitModule = typeof import('@kingstinct/react-native-healthkit');

/**
 * HealthKit is a Nitro (native) module — merely importing it throws
 * synchronously inside Expo Go ("NitroModules are not supported in Expo
 * Go"), before any Platform.OS check in a function body ever runs. So this
 * package can never appear in a static top-level `import` here: it's
 * `require`d lazily, and only outside Expo Go on iOS, so `npx expo start`
 * in Expo Go keeps working for local iteration on everything else — this
 * feature just silently no-ops there, same as it does on Android.
 */
function loadHealthKit(): HealthKitModule | null {
  if (Platform.OS !== 'ios' || isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see doc comment above
    return require('@kingstinct/react-native-healthkit');
  } catch {
    return null;
  }
}

export async function isAppleHealthAvailable(): Promise<boolean> {
  const healthKit = loadHealthKit();
  if (!healthKit) return false;
  try {
    return await healthKit.isHealthDataAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Requests read-only access to Active Energy Burned. Apple's read-only
 * authorization model never reports back whether the user granted or denied
 * it (only write/share permissions are introspectable) — this promise
 * resolves once the system prompt (or no-op, if already decided) completes,
 * not with the user's actual answer.
 */
export async function requestAppleHealthAuthorization(): Promise<boolean> {
  const healthKit = loadHealthKit();
  if (!healthKit) return false;
  try {
    return await healthKit.requestAuthorization({ toRead: [ACTIVE_ENERGY_BURNED, WORKOUT_TYPE] });
  } catch {
    return false;
  }
}

/**
 * Sums active calories burned between two dates (a checkin's
 * captured_at/checkout_captured_at window). Never throws — returns null if
 * unavailable, denied, or no data for that window.
 *
 * Computes two independent estimates and takes whichever is higher:
 * 1) A workout's own totalEnergyBurned — a dedicated device (Garmin, etc.)
 *    usually attaches its calorie total to the HKWorkout object itself,
 *    exactly what the Health app displays for that session.
 * 2) The sum of loose ActiveEnergyBurned quantity samples in the window —
 *    what a phone's own ambient tracking (or a device that doesn't mirror
 *    its workout total as quantity samples) contributes.
 * Neither source is reliably a superset of the other, so taking the max
 * avoids undercounting — this is a cosmetic, display-only number that's
 * never used for penalties/ranking, so erring toward the higher estimate is
 * the right tradeoff. Each query fails independently (one throwing, e.g. a
 * permissions quirk, doesn't discard whatever the other one found).
 */
export async function getActiveEnergyBurnedKcal(start: Date, end: Date): Promise<number | null> {
  const healthKit = loadHealthKit();
  if (!healthKit) return null;

  await requestAppleHealthAuthorization();

  let workoutKcal = 0;
  try {
    const workouts = await healthKit.queryWorkoutSamples({
      filter: { date: { startDate: start, endDate: end } },
      limit: 0,
    });
    workoutKcal = workouts
      .map((w) => w.totalEnergyBurned)
      .filter((q): q is NonNullable<typeof q> => !!q && q.unit === 'kcal')
      .reduce((sum, q) => sum + q.quantity, 0);
  } catch {
    // best-effort — the sample-based estimate below still stands a chance
  }

  let sampleKcal = 0;
  try {
    const response = await healthKit.queryStatisticsForQuantity(ACTIVE_ENERGY_BURNED, ['cumulativeSum'], {
      filter: { date: { startDate: start, endDate: end } },
      unit: 'kcal',
    });
    sampleKcal = response.sumQuantity?.quantity ?? 0;
  } catch {
    // best-effort — whatever the workout query found above still stands
  }

  const best = Math.max(workoutKcal, sampleKcal);
  return best > 0 ? best : null;
}
