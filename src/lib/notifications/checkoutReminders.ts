import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { CHECKOUT_GEOFENCE_TASK } from './checkoutGeofenceTask';

const REMINDER_DELAY_SECONDS = 20 * 60;
const GEOFENCE_RADIUS_METERS = 150;

/**
 * Starts both checkout reminders for a just-confirmed check-in: a local
 * notification ~20 min later, and (best-effort, only if background location
 * is granted) a geofence around the check-in spot that fires immediately if
 * the member leaves before checking out. Using the checkin row's own id as
 * the notification identifier means cancelCheckoutReminders can cancel it
 * later with no extra persisted state, even across an app restart.
 */
export async function scheduleCheckoutReminders(
  checkinId: string,
  latitude: number,
  longitude: number
): Promise<void> {
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

  try {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== 'granted') return;
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
    // best-effort — geofencing is a nice-to-have on top of the time-based reminder
  }
}

/** Cancels both checkout reminders — call once the checkout photo is confirmed. */
export async function cancelCheckoutReminders(checkinId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(checkinId).catch(() => {});
  await stopCheckoutGeofence();
}

/** Safety net for when the geofence exit event never fired (e.g. app was killed). */
export async function stopCheckoutGeofence(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(CHECKOUT_GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(CHECKOUT_GEOFENCE_TASK);
    }
  } catch {
    // best-effort
  }
}
