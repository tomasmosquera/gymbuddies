import { isAppleHealthAvailable, requestAppleHealthAuthorization, getActiveEnergyBurnedKcal as getActiveEnergyBurnedKcalIOS } from './appleHealth';
import {
  isHealthConnectAvailable,
  requestHealthConnectAuthorization,
  getActiveEnergyBurnedKcalHealthConnect,
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
