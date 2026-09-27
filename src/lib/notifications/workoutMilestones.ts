import * as Notifications from 'expo-notifications';
import { WORKOUT_MILESTONE_IDS, workoutMilestones, type WorkoutActivityProps } from '@/lib/domain/workoutActivity';
import { getRemindersEnabledCache } from './reminderPreference';

// Serialised for the same reason as the Live Activity sync: two runs back to back must not interleave
// their cancel/schedule steps.
let queue: Promise<void> = Promise.resolve();

async function apply(props: WorkoutActivityProps | null, now: Date): Promise<void> {
  try {
    await Promise.all(
      Object.values(WORKOUT_MILESTONE_IDS).map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
    );
    if (!props) return;
    // The same "Recordatorios" switch that governs the checkout reminders.
    if (!(await getRemindersEnabledCache())) return;
    for (const milestone of workoutMilestones(props, now)) {
      await Notifications.scheduleNotificationAsync({
        identifier: milestone.id,
        content: { title: 'Gym Buddies', body: milestone.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: milestone.at },
      });
    }
  } catch (error) {
    // best-effort — a missing reminder must never get in the way of the check-in
    console.warn('[workoutMilestones] could not schedule the workout notifications', error);
  }
}

/**
 * Schedules (or clears) the local notifications that go with the workout timer: "you reached the
 * minimum" and "your timer is about to end". Idempotent — the fixed identifiers replace whatever was
 * scheduled before — and it never throws. Pass null when the workout is over.
 */
export function syncWorkoutMilestoneNotifications(props: WorkoutActivityProps | null, now: Date = new Date()): Promise<void> {
  queue = queue.then(() => apply(props, now));
  return queue;
}
