import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type HealthConnectModule = typeof import('react-native-health-connect');

/**
 * Mirrors react-native-health-connect's own SdkAvailabilityStatus constant
 * values (1/2/3) as plain numbers, so callers (e.g. Settings) can compare
 * against these without a real (non-type-only) import of the package —
 * that import alone would throw in Expo Go, same reason loadHealthConnect
 * below only ever require()s it lazily.
 */
export const HEALTH_CONNECT_SDK_STATUS = {
  SDK_UNAVAILABLE: 1,
  SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
  SDK_AVAILABLE: 3,
} as const;

/**
 * Health Connect is a native module — same Expo Go restriction as
 * @kingstinct/react-native-healthkit on iOS (see appleHealth.ts), so it's
 * require()d lazily and only outside Expo Go on Android, keeping
 * `npx expo start` in Expo Go working for everyone else. This feature just
 * silently no-ops there, same as it does on iOS.
 */
function loadHealthConnect(): HealthConnectModule | null {
  if (Platform.OS !== 'android' || isExpoGo) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see doc comment above
    return require('react-native-health-connect');
  } catch {
    return null;
  }
}

/**
 * True only once Health Connect is installed and initialized. A phone on
 * Android <14 without the separate Health Connect app installed reports
 * SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED here — distinct from a hard
 * SDK_UNAVAILABLE (unsupported device), so callers that want to offer an
 * "instalar Health Connect" link can tell the two apart via
 * getHealthConnectSdkStatus below instead of this boolean.
 */
export async function isHealthConnectAvailable(): Promise<boolean> {
  const hc = loadHealthConnect();
  if (!hc) return false;
  try {
    const status = await hc.getSdkStatus();
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return false;
    return await hc.initialize();
  } catch {
    return false;
  }
}

/** SdkAvailabilityStatus value (1 unavailable, 2 needs the provider app installed/updated, 3 available), or null if not on Android/Expo Go. */
export async function getHealthConnectSdkStatus(): Promise<number | null> {
  const hc = loadHealthConnect();
  if (!hc) return null;
  try {
    return await hc.getSdkStatus();
  } catch {
    return null;
  }
}

/**
 * Requests read access to Active/Total Calories Burned/Weight, plus WRITE
 * access to ExerciseSession/TotalCaloriesBurned — the latter is what lets
 * saveWorkoutToHealthConnect below actually save a completed exercise
 * session (and with it, credit the day's exercise/activity totals), not
 * just read passive data. Like HealthKit's model, Health Connect doesn't
 * reliably report back per-permission grant/deny here either — this
 * resolves once the system prompt (or no-op, if already decided) completes,
 * not with the user's actual answer.
 */
export async function requestHealthConnectAuthorization(): Promise<boolean> {
  const hc = loadHealthConnect();
  if (!hc) return false;
  try {
    await hc.initialize();
    await hc.requestPermission([
      { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
      { accessType: 'read', recordType: 'TotalCaloriesBurned' },
      { accessType: 'read', recordType: 'Weight' },
      { accessType: 'write', recordType: 'ExerciseSession' },
      { accessType: 'write', recordType: 'TotalCaloriesBurned' },
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sums calories burned between two dates (a checkin's
 * captured_at/checkout_captured_at window). Never throws — returns null if
 * unavailable, denied, or no data for that window.
 *
 * Same "take whichever estimate is higher" approach as getActiveEnergyBurnedKcal
 * in appleHealth.ts, adapted to Health Connect's record types instead of
 * HealthKit's: ActiveCaloriesBurned (just the active portion, what a phone's
 * own ambient tracking usually contributes) vs. TotalCaloriesBurned (what a
 * synced device like Samsung Health/Garmin/Fitbit tends to report as the
 * workout's own total). Neither is reliably a superset of the other, and this
 * is a cosmetic, display-only number that never feeds penalties/ranking, so
 * erring toward the higher estimate is the right tradeoff. Each aggregate
 * query fails independently.
 */
export async function getActiveEnergyBurnedKcalHealthConnect(start: Date, end: Date): Promise<number | null> {
  const hc = loadHealthConnect();
  if (!hc) return null;

  await requestHealthConnectAuthorization();

  const timeRangeFilter = { operator: 'between' as const, startTime: start.toISOString(), endTime: end.toISOString() };

  let activeKcal = 0;
  try {
    const result = await hc.aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter });
    activeKcal = result.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0;
  } catch {
    // best-effort — the total-calories estimate below still stands a chance
  }

  let totalKcal = 0;
  try {
    const result = await hc.aggregateRecord({ recordType: 'TotalCaloriesBurned', timeRangeFilter });
    totalKcal = result.ENERGY_TOTAL?.inKilocalories ?? 0;
  } catch {
    // best-effort — whatever the active-calories query found above still stands
  }

  const best = Math.max(activeKcal, totalKcal);
  return best > 0 ? best : null;
}

/** The most recent Weight record on file, in kg, or null if unavailable/denied/never recorded. Never throws. */
export async function getBodyWeightKgHealthConnect(): Promise<number | null> {
  const hc = loadHealthConnect();
  if (!hc) return null;

  await requestHealthConnectAuthorization();

  try {
    const result = await hc.readRecords('Weight', {
      timeRangeFilter: { operator: 'before', endTime: new Date().toISOString() },
      ascendingOrder: false,
      pageSize: 1,
    });
    return result.records[0]?.weight.inKilograms ?? null;
  } catch {
    return null;
  }
}

/**
 * Saves a completed exercise session to Health Connect — a STRENGTH_TRAINING
 * session spanning [start, end], plus a matching TotalCaloriesBurned record
 * for kcal (Health Connect models a session's energy as a separate record,
 * not a field on the session itself, unlike HealthKit's HKWorkout). This is
 * what lets a routine session count toward the day's exercise/activity
 * totals even without a wearable actively tracking anything. Best-effort —
 * never throws, and a false return (denied permission, no Health Connect,
 * or an insert error) is silently swallowed by the caller; this is a
 * nice-to-have record, not something any check-in/penalty logic depends on.
 */
export async function saveWorkoutToHealthConnect(start: Date, end: Date, kcal: number): Promise<boolean> {
  const hc = loadHealthConnect();
  if (!hc) return false;

  await requestHealthConnectAuthorization();

  try {
    await hc.insertRecords([
      {
        recordType: 'ExerciseSession',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        exerciseType: hc.ExerciseType.STRENGTH_TRAINING,
        title: 'Gym Buddies',
      },
      {
        recordType: 'TotalCaloriesBurned',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        energy: { value: kcal, unit: 'kilocalories' },
      },
    ]);
    return true;
  } catch {
    return false;
  }
}
