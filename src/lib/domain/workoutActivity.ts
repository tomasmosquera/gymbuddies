/** Where the Live Activity's "Tomar foto final" buttons (and a tap on the activity itself) send the user: the check-in tab, straight into the final-photo step. */
export const WORKOUT_ACTIVITY_URL = 'gymbuddies://checkin?checkout=1';

/** iOS ends a Live Activity 8 hours after it starts, so a check-in older than that is not worth (re)starting one for. */
export const WORKOUT_ACTIVITY_MAX_AGE_HOURS = 8;

/** What the Live Activity renders — plain data, so it can cross into the widget's isolated runtime. */
export interface WorkoutActivityProps {
  /** ISO instant of the check-in photo — the timer counts up from here. */
  startedAt: string;
  /** The group's minimum workout length; 0 = no minimum (no progress bar). */
  minMinutes: number;
  groupName: string;
  /** Where the "Tomar foto final" buttons send the user. It travels in the props because the widget runs in an isolated runtime and cannot import it. */
  checkoutUrl: string;
}

interface CheckinLike {
  captured_at: string;
  checkout_captured_at: string | null;
}

/**
 * What the lock-screen workout timer should show right now, or null when there should be none.
 * There is one exactly while a check-in is waiting for its final photo: the group asks for one
 * and today's check-in exists without it. Everything else (no check-in yet, checkout already
 * done, a group that doesn't ask for a final photo, a check-in too old to still be a workout)
 * means no activity — which is also how a finished or deleted workout ends it.
 */
export function workoutActivityFor(input: {
  requireCheckoutPhoto: boolean;
  checkin: CheckinLike | null;
  minWorkoutMinutes: number;
  groupName: string;
  now?: Date;
}): WorkoutActivityProps | null {
  const { requireCheckoutPhoto, checkin, minWorkoutMinutes, groupName } = input;
  if (!requireCheckoutPhoto || !checkin || checkin.checkout_captured_at) return null;
  const ageMs = (input.now ?? new Date()).getTime() - new Date(checkin.captured_at).getTime();
  if (ageMs < 0 || ageMs > WORKOUT_ACTIVITY_MAX_AGE_HOURS * 60 * 60 * 1000) return null;
  return {
    startedAt: checkin.captured_at,
    minMinutes: Math.max(0, Math.floor(minWorkoutMinutes)),
    groupName,
    checkoutUrl: WORKOUT_ACTIVITY_URL,
  };
}

export function sameWorkoutActivity(a: WorkoutActivityProps | null, b: WorkoutActivityProps | null): boolean {
  if (a === null || b === null) return a === b;
  return a.startedAt === b.startedAt && a.minMinutes === b.minMinutes && a.groupName === b.groupName;
}
