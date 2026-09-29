import {
  isAppleHealthAvailable,
  requestAppleHealthAuthorization,
  getActiveEnergyBurnedKcal as getActiveEnergyBurnedKcalIOS,
  getBodyWeightKg,
  saveWorkoutToAppleHealth,
} from './appleHealth';
import {
  isHealthConnectAvailable,
  requestHealthConnectAuthorization,
  getActiveEnergyBurnedKcalHealthConnect,
  getBodyWeightKgHealthConnect,
  saveWorkoutToHealthConnect,
} from './healthConnect';

/**
 * Cross-platform entrypoint: each underlying function already no-ops on the
 * wrong platform (appleHealth.ts on Android, healthConnect.ts on iOS — see
 * their own doc comments), so it's always safe to call both here and use
 * whichever one actually did something. Callers (useAppleHealth.ts,
 * checkin/preview.tsx, profile/settings.tsx) should import from here instead
 * of reaching into appleHealth.ts/healthConnect.ts directly.
 */
export async function isHealthAvailable(): Promise<boolean> {
  return (await isAppleHealthAvailable()) || (await isHealthConnectAvailable());
}

export async function requestHealthAuthorization(): Promise<boolean> {
  return (await requestAppleHealthAuthorization()) || (await requestHealthConnectAuthorization());
}

export async function getActiveEnergyBurnedKcal(start: Date, end: Date): Promise<number | null> {
  return (await getActiveEnergyBurnedKcalIOS(start, end)) ?? (await getActiveEnergyBurnedKcalHealthConnect(start, end));
}

/** The member's own body weight in kg, straight from Health/Health Connect's own body-mass record — null if unavailable, denied, or never recorded on either platform. Used to personalize estimateWorkoutCalories; callers fall back further (profiles.body_weight_kg, then a generic default) when this comes back null. */
export async function getBodyWeightFromHealth(): Promise<number | null> {
  return (await getBodyWeightKg()) ?? (await getBodyWeightKgHealthConnect());
}

/**
 * Saves a completed routine session as a finished workout to whichever of
 * Health/Health Connect applies on this platform — see
 * appleHealth.ts/healthConnect.ts's own doc comments for what this actually
 * unlocks (crediting the day's Exercise ring/activity totals even without a
 * wearable tracking it live). Best-effort: a false return means neither
 * platform saved anything (no Health app, denied permission, or a save
 * error) — the caller should treat this the same as "nothing to do", never
 * as a reason to fail the workout finishing itself.
 */
export async function saveWorkoutToHealth(start: Date, end: Date, kcal: number): Promise<boolean> {
  return (await saveWorkoutToAppleHealth(start, end, kcal)) || (await saveWorkoutToHealthConnect(start, end, kcal));
}
