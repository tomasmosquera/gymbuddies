import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { CHECKIN_ARRIVAL_RADIUS_METERS, distanceMeters } from '@/lib/domain/geo';
import { shouldFireArrivalReminder, todayLocalDateString } from '@/lib/domain/checkinReminders';
import { CHECKIN_ARRIVAL_GEOFENCE_TASK } from './checkinArrivalGeofenceTask';
import { getRemindersEnabledCache } from './reminderPreference';
import { getLastArrivalReminderDateCache, getLastCheckinDateCache, setLastArrivalReminderDateCache } from './checkinArrivalCache';

const FOREGROUND_WATCH_DISTANCE_INTERVAL_METERS = 20;

export interface ArrivalLocation {
  latitude: number;
  longitude: number;
}

// Module-level singleton state for the foreground fallback watch — there is
// only ever one active group being watched at a time, same assumption
// checkoutReminders.ts already makes for its own single-region case.
let foregroundSubscription: Location.LocationSubscription | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let watchedLocations: ArrivalLocation[] = [];

async function fireArrivalReminderIfDue(): Promise<void> {
  if (!(await getRemindersEnabledCache())) return;
  const today = todayLocalDateString();
  const shouldFire = shouldFireArrivalReminder({
    today,
    lastCheckinDateCached: await getLastCheckinDateCache(),
    lastReminderDateCached: await getLastArrivalReminderDateCache(),
  });
  if (!shouldFire) return;

  await setLastArrivalReminderDateCache(today);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Gym Buddies',
      body: 'Llegaste al gimnasio — no olvides tomar tu foto de check-in.',
      data: { category: 'reminders' },
    },
    trigger: null,
  }).catch(() => {});
}

async function runForegroundWatchIfActive(): Promise<void> {
  if (watchedLocations.length === 0 || AppState.currentState !== 'active' || foregroundSubscription) return;
  try {
    foregroundSubscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: FOREGROUND_WATCH_DISTANCE_INTERVAL_METERS },
      (position) => {
        const isNearAnyLocation = watchedLocations.some(
          (loc) =>
            distanceMeters(loc.latitude, loc.longitude, position.coords.latitude, position.coords.longitude) <=
            CHECKIN_ARRIVAL_RADIUS_METERS
        );
        if (isNearAnyLocation) fireArrivalReminderIfDue();
      }
    );
  } catch {
    // best-effort — this is itself already a fallback, never throw past it
  }
}

function stopForegroundWatchSubscription(): void {
  foregroundSubscription?.remove();
  foregroundSubscription = null;
}

/**
 * Starts (or refreshes) the arrival reminder for a group's known check-in
 * spots: a foreground distance watch (needs only "When In Use", already
 * granted for check-in itself) plus — best-effort, only if "Always" location
 * is already granted — a background geofence that also fires while the app
 * is closed. Unlike scheduleCheckoutReminders, this never shows an "activate
 * Always location" prompt of its own — that ask already happens the first
 * time a member schedules a checkout reminder, and repeating it here for the
 * same underlying permission would just be nagging.
 *
 * Safe to call repeatedly (new active group, or an updated location list) —
 * it simply replaces the previously-watched locations/regions.
 */
export async function startArrivalGeofence(groupId: string, locations: ArrivalLocation[]): Promise<void> {
  if (locations.length === 0 || !(await getRemindersEnabledCache())) {
    await stopArrivalGeofence();
    return;
  }

  watchedLocations = locations;
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') runForegroundWatchIfActive();
      else stopForegroundWatchSubscription();
    });
  }
  runForegroundWatchIfActive();

  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== 'granted') return;
    await Location.startGeofencingAsync(
      CHECKIN_ARRIVAL_GEOFENCE_TASK,
      locations.map((loc, i) => ({
        identifier: `${groupId}-${i}`,
        latitude: loc.latitude,
        longitude: loc.longitude,
        radius: CHECKIN_ARRIVAL_RADIUS_METERS,
        notifyOnEnter: true,
        notifyOnExit: false,
      }))
    );
  } catch {
    // best-effort — geofencing is a nice-to-have on top of the foreground watch
  }
}

/** Stops both the foreground watch and the background geofence — call on sign-out, or when there are no known locations left to watch. */
export async function stopArrivalGeofence(): Promise<void> {
  watchedLocations = [];
  stopForegroundWatchSubscription();
  appStateSubscription?.remove();
  appStateSubscription = null;
  try {
    if (await Location.hasStartedGeofencingAsync(CHECKIN_ARRIVAL_GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(CHECKIN_ARRIVAL_GEOFENCE_TASK);
    }
  } catch {
    // best-effort
  }
}
