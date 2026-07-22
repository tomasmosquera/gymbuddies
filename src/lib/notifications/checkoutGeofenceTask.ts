import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { GeofencingEventType, stopGeofencingAsync } from 'expo-location';
import { getRemindersEnabledCache } from './reminderPreference';

/**
 * Imported once for its side effect (in app/_layout.tsx) — defineTask must
 * run before any startGeofencingAsync call, including ones made from a
 * previous app session that the OS resumes in the background.
 */
export const CHECKOUT_GEOFENCE_TASK = 'checkout-geofence-task';

TaskManager.defineTask(CHECKOUT_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const { eventType } = data as { eventType: GeofencingEventType };
  if (eventType !== GeofencingEventType.Exit) return;

  if (await getRemindersEnabledCache()) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Gym Buddies',
        body: 'Parece que ya te alejaste del gimnasio — no olvides tomar tu foto de salida.',
      },
      trigger: null,
    }).catch(() => {});
  }

  // One-shot per pending checkout — the reminder already fired.
  await stopGeofencingAsync(CHECKOUT_GEOFENCE_TASK).catch(() => {});
});
