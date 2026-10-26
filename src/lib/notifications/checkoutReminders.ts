import { Alert, AppState, Linking, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { distanceMeters } from '@/lib/domain/geo';
import { confirmBackgroundLocationDisclosure } from '@/lib/location/backgroundLocationDisclosure';
import { CHECKOUT_GEOFENCE_TASK } from './checkoutGeofenceTask';
import { getRemindersEnabledCache } from './reminderPreference';

// Fixed identifiers — this reminder is ONE global, per-person thing (same idiom as
// restTimer.ts's REST_TIMER_NOTIFICATION_ID), never one per check-in: a member pending
// checkout in several groups at once (e.g. "check-in en otros grupos" fanned out to all of
// them) used to get one of these PER GROUP, since each used to be keyed by that check-in's own
// id — scheduling again with the same fixed id here naturally replaces whatever was pending
// instead of stacking a duplicate alongside it.
const CHECKOUT_REMINDER_NOTIFICATION_ID = 'gymbuddies-checkout-reminder';
const CHECKOUT_REMINDER_FOREGROUND_NOTIFICATION_ID = 'gymbuddies-checkout-reminder-foreground';

/** Falls back to this if a caller doesn't have the member's profile loaded yet — matches profiles.checkout_reminder_minutes' own DB default. */
const DEFAULT_REMINDER_MINUTES = 20;
/** Falls back to this if a caller doesn't have the member's profile loaded yet — matches profiles.checkout_geofence_radius_meters' own DB default. */
const DEFAULT_GEOFENCE_RADIUS_METERS = 100;
const FOREGROUND_WATCH_DISTANCE_INTERVAL_METERS = 20;

// Module-level singleton state for the foreground fallback watch — there is
// only ever one pending checkout at a time, same assumption the background
// geofence task already makes with its single fixed task name.
let foregroundSubscription: Location.LocationSubscription | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let pendingWatch: { latitude: number; longitude: number; radiusMeters: number } | null = null;

async function runForegroundWatchIfActive(): Promise<void> {
  if (!pendingWatch || AppState.currentState !== 'active' || foregroundSubscription) return;
  const { latitude, longitude, radiusMeters } = pendingWatch;
  try {
    foregroundSubscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: FOREGROUND_WATCH_DISTANCE_INTERVAL_METERS },
      (position) => {
        const distance = distanceMeters(latitude, longitude, position.coords.latitude, position.coords.longitude);
        if (distance > radiusMeters) {
          // Tears down pendingWatch AND the AppState listener, not just this
          // one subscription — stopForegroundWatchSubscription() alone left
          // pendingWatch set, so every later AppState 'active' transition
          // (screen on/off, switching apps back) re-armed watchPositionAsync,
          // whose first reading was still past the radius, re-firing this
          // same notification every single time — reported as ~10 copies of
          // it in 20 minutes. One warning is enough; nothing downstream
          // needs this watch running again after it's already fired once.
          stopForegroundDistanceWatch();
          getRemindersEnabledCache().then((enabled) => {
            if (!enabled) return;
            Notifications.scheduleNotificationAsync({
              identifier: CHECKOUT_REMINDER_FOREGROUND_NOTIFICATION_ID,
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
function startForegroundDistanceWatch(latitude: number, longitude: number, radiusMeters: number): void {
  pendingWatch = { latitude, longitude, radiusMeters };
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
 * notification `reminderMinutes` later (each member's own
 * profiles.checkout_reminder_minutes, 20 by default), a foreground distance
 * watch (only needs "When In Use"), and — best-effort, only if "Always"
 * location is granted — a background geofence that also fires while the app
 * is closed. One global reminder per person, not one per check-in: calling
 * this again (e.g. a second group's check-in fanned out the same moment, or
 * a retake) replaces whichever reminder/geofence was already pending instead
 * of adding another alongside it — see the fixed-id comment above.
 */
export async function scheduleCheckoutReminders(
  latitude: number,
  longitude: number,
  reminderMinutes: number = DEFAULT_REMINDER_MINUTES,
  geofenceRadiusMeters: number = DEFAULT_GEOFENCE_RADIUS_METERS
): Promise<void> {
  if (!(await getRemindersEnabledCache())) return;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: CHECKOUT_REMINDER_NOTIFICATION_ID,
      content: {
        title: 'Gym Buddies',
        body: 'No olvides tomar tu foto de salida del entreno.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: reminderMinutes * 60,
      },
    });
  } catch {
    // best-effort — never block the check-in flow over a reminder
  }

  startForegroundDistanceWatch(latitude, longitude, geofenceRadiusMeters);

  try {
    // Google Play's Prominent Disclosure requirement for background
    // location — see confirmBackgroundLocationDisclosure's own doc comment.
    // Only shown the first time the OS itself hasn't decided yet; once
    // granted or denied, requestBackgroundPermissionsAsync below is a no-op
    // either way, so asking again would just be noise.
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.status === 'undetermined') {
      const agreed = await confirmBackgroundLocationDisclosure();
      if (!agreed) return;
    }

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
        identifier: CHECKOUT_REMINDER_NOTIFICATION_ID,
        latitude,
        longitude,
        radius: geofenceRadiusMeters,
        notifyOnEnter: false,
        notifyOnExit: true,
      },
    ]);
  } catch {
    // best-effort — geofencing is a nice-to-have on top of the other reminders
  }
}

/** Cancels the (one, global) pending checkout reminder — call once a checkout photo is confirmed. */
export async function cancelCheckoutReminders(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(CHECKOUT_REMINDER_NOTIFICATION_ID).catch(() => {});
  await Notifications.cancelScheduledNotificationAsync(CHECKOUT_REMINDER_FOREGROUND_NOTIFICATION_ID).catch(() => {});
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
