import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { GeofencingEventType } from 'expo-location';
import { shouldFireArrivalReminder, todayLocalDateString } from '@/lib/domain/checkinReminders';
import { getRemindersEnabledCache } from './reminderPreference';
import {
  getLastArrivalReminderDateCache,
  getLastCheckinDateCache,
  setLastArrivalReminderDateCache,
} from './checkinArrivalCache';

/**
 * Imported once for its side effect (in app/_layout.tsx) — defineTask must
 * run before any startGeofencingAsync call, including ones the OS resumes
 * in the background from a previous app session. Same requirement as
 * checkoutGeofenceTask.ts's CHECKOUT_GEOFENCE_TASK.
 */
export const CHECKIN_ARRIVAL_GEOFENCE_TASK = 'checkin-arrival-geofence-task';

TaskManager.defineTask(CHECKIN_ARRIVAL_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const { eventType } = data as { eventType: GeofencingEventType };
  if (eventType !== GeofencingEventType.Enter) return;
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
      // Lets a tap route straight to /checkin (see notificationRouting.ts's
      // categoryDefaultRoute for 'reminders').
      data: { category: 'reminders' },
    },
    trigger: null,
  }).catch(() => {});

  // No stopGeofencingAsync here — unlike the checkout exit task, this one is
  // NOT one-shot: it has to keep watching for tomorrow's arrival too.
});
