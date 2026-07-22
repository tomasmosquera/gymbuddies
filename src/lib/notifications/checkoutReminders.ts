import { Alert, AppState, Linking, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { distanceMeters } from '@/lib/domain/geo';
import { CHECKOUT_GEOFENCE_TASK } from './checkoutGeofenceTask';
import { getRemindersEnabledCache } from './reminderPreference';

const REMINDER_DELAY_SECONDS = 20 * 60;
const GEOFENCE_RADIUS_METERS = 100;
const FOREGROUND_WATCH_DISTANCE_INTERVAL_METERS = 20;

// Module-level singleton state for the foreground fallback watch — there is
// only ever one pending checkout at a time, same assumption the background
// geofence task already makes with its single fixed task name.
let foregroundSubscription: Location.LocationSubscription | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let pendingWatch: { checkinId: string; latitude: number; longitude: number } | null = null;

async function runForegroundWatchIfActive(): Promise<void> {
  if (!pendingWatch || AppState.currentState !== 'active' || foregroundSubscription) return;
  const { checkinId, latitude, longitude } = pendingWatch;
  try {
    foregroundSubscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: FOREGROUND_WATCH_DISTANCE_INTERVAL_METERS },
      (position) => {
        const distance = distanceMeters(latitude, longitude, position.coords.latitude, position.coords.longitude);
        if (distance > GEOFENCE_RADIUS_METERS) {
          stopForegroundWatchSubscription();
          getRemindersEnabledCache().then((enabled) => {
            if (!enabled) return;
            Notifications.scheduleNotificationAsync({
              identifier: `${checkinId}-foreground`,
              content: {
                title: 'Gym Buddies',
                body: 'Parece que ya te alejaste del gimnasio — no olvides tomar tu foto de salida.',
              },
              trigger: null,
            }).catch(() => {});
          });
        }
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
 * Foreground-only fallback for members who never granted "Always" location:
 * while the app is open and active, watch position (needs only "When In
 * Use", already granted for check-in itself) and fire the same notification
 * if they drift past the geofence radius. Stops automatically once the app
 * backgrounds — foreground-only permission can't track past that point
 * anyway — and restarts if the app comes back to the foreground with a
 * checkout still pending.
 */
function startForegroundDistanceWatch(checkinId: string, latitude: number, longitude: number): void {
  pendingWatch = { checkinId, latitude, longitude };
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') runForegroundWatchIfActive();
      else stopForegroundWatchSubscription();
    });
  }
  runForegroundWatchIfActive();
}

function stopForegroundDistanceWatch(): void {
  pendingWatch = null;
  stopForegroundWatchSubscription();
  appStateSubscription?.remove();
  appStateSubscription = null;
}

/**
 * Starts every checkout reminder for a just-confirmed check-in: a local
 * notification ~20 min later, a foreground distance watch (only needs
 * "When In Use"), and — best-effort, only if "Always" location is granted —
 * a background geofence that also fires while the app is closed. Using the
 * checkin row's own id as the notification identifier means
 * cancelCheckoutReminders can cancel it later with no extra persisted
 * state, even across an app restart.
 */
export async function scheduleCheckoutReminders(
  checkinId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  if (!(await getRemindersEnabledCache())) return;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: checkinId,
      content: {
        title: 'Gym Buddies',
        body: 'No olvides tomar tu foto de salida del entreno.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: REMINDER_DELAY_SECONDS,
      },
    });
  } catch {
    // best-effort — never block the check-in flow over a reminder
  }

  startForegroundDistanceWatch(checkinId, latitude, longitude);

  try {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== 'granted') {
      // Silently giving up here means the background reminder just never
      // fires again, with nothing telling the member or us why — iOS only
      // shows its own "Always Allow" upgrade prompt once, so if it was
      // dismissed the first time, requestBackgroundPermissionsAsync keeps
      // coming back 'denied' forever unless the member fixes it manually.
      Alert.alert(
        'Activa la ubicación "Siempre"',
        'Para avisarte si te alejas del gimnasio incluso con la app cerrada, activa el permiso de ubicación "Siempre" (no solo "mientras se usa"). Mientras tanto, ya te avisamos igual si te alejas con la app abierta.',
        [
          { text: 'Ahora no', style: 'cancel' },
          { text: 'Abrir ajustes', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    await Location.startGeofencingAsync(CHECKOUT_GEOFENCE_TASK, [
      {
        identifier: checkinId,
        latitude,
        longitude,
        radius: GEOFENCE_RADIUS_METERS,
        notifyOnEnter: false,
        notifyOnExit: true,
      },
    ]);
  } catch {
    // best-effort — geofencing is a nice-to-have on top of the other reminders
  }
}

/** Cancels every checkout reminder — call once the checkout photo is confirmed. */
export async function cancelCheckoutReminders(checkinId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(checkinId).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(`${checkinId}-foreground`).catch(() => {});
  stopForegroundDistanceWatch();
  await stopCheckoutGeofence();
}

/** Safety net for when the geofence exit event never fired (e.g. app was killed). */
export async function stopCheckoutGeofence(): Promise<void> {
  stopForegroundDistanceWatch();
  try {
    if (await Location.hasStartedGeofencingAsync(CHECKOUT_GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(CHECKOUT_GEOFENCE_TASK);
    }
  } catch {
    // best-effort
  }
}
