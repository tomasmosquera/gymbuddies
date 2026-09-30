import * as Notifications from 'expo-notifications';

/** Fixed identifier — same trick as workoutMilestones.ts's own: scheduling again with this same id just replaces whatever was pending, so starting a new rest period before an old notification fires can never leave two scheduled at once. */
export const REST_TIMER_NOTIFICATION_ID = 'gymbuddies-rest-timer-done';

/**
 * Schedules the local notification for when a rest period ends — delivered
 * by the OS itself even if the member has left the app or locked the
 * screen, unlike useRestTimer's own in-app sound/haptic (those only fire
 * while this exact screen is mounted and the JS timer is actually able to
 * tick, which stops within seconds of backgrounding on both platforms).
 * Same mechanism this project already uses for the workout-duration
 * milestones, just for a much shorter countdown.
 */
export async function scheduleRestTimerNotification(endAt: Date): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: REST_TIMER_NOTIFICATION_ID,
      content: { title: 'Gym Buddies', body: '¡Descanso terminado! 💪 Hora de la siguiente serie.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: endAt },
    });
  } catch (error) {
    // best-effort — a missing notification must never get in the way of the rest timer itself
    console.warn('[restTimer] could not schedule the rest-timer notification', error);
  }
}

/**
 * Cancels any pending rest-timer notification — the countdown ending on its
 * own while the app is in the foreground already alerted in-app, skipping
 * early means there's nothing left to alert about, and neither should leave
 * a stale notification waiting to fire later for a rest period that's
 * already over one way or another.
 */
export async function cancelRestTimerNotification(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(REST_TIMER_NOTIFICATION_ID);
  } catch {
    // best-effort — nothing to recover, there's nothing pending to fail to cancel in practice
  }
}
