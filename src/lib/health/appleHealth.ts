import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const ACTIVE_ENERGY_BURNED = 'HKQuantityTypeIdentifierActiveEnergyBurned' as const;

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
    return await healthKit.requestAuthorization({ toRead: [ACTIVE_ENERGY_BURNED] });
  } catch {
    return false;
  }
}

/** Sums active calories burned between two dates (a checkin's captured_at/checkout_captured_at window). Never throws — returns null if unavailable, denied, or no data for that window. */
export async function getActiveEnergyBurnedKcal(start: Date, end: Date): Promise<number | null> {
  const healthKit = loadHealthKit();
  if (!healthKit) return null;
  try {
    const response = await healthKit.queryStatisticsForQuantity(ACTIVE_ENERGY_BURNED, ['cumulativeSum'], {
      filter: { date: { startDate: start, endDate: end } },
      unit: 'kcal',
    });
    return response.sumQuantity?.quantity ?? null;
  } catch {
    return null;
  }
}
