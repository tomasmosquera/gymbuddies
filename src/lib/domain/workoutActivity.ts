/** Where the Live Activity's "Tomar Foto Final" buttons (and a tap on the activity itself) send the user: the check-in tab, straight into the final-photo step. */
export const WORKOUT_ACTIVITY_URL = 'gymbuddies://checkin?checkout=1';

/** iOS ends a Live Activity 8 hours after it starts, so a check-in older than that is not worth (re)starting one for. */
export const WORKOUT_ACTIVITY_MAX_AGE_HOURS = 8;

/** How long before iOS ends the activity the "your timer is about to end" reminder is sent. */
export const WORKOUT_ENDING_SOON_LEAD_MINUTES = 30;

/** What the Live Activity renders — plain data, so it can cross into the widget's isolated runtime. */
export interface WorkoutActivityProps {
  /** ISO instant of the earliest pending check-in photo — the timer counts up from here. */
  startedAt: string;
  /** The highest minimum workout length among the groups still waiting for a final photo; 0 = no minimum (no progress bar). */
  minMinutes: number;
  /** The group's name when only one is pending, otherwise "N grupos". */
  groupLabel: string;
  /** Where the "Tomar Foto Final" buttons send the user. It travels in the props because the widget runs in an isolated runtime and cannot import it. */
  checkoutUrl: string;
}

interface CheckinLike {
  captured_at: string;
  checkout_captured_at: string | null;
}

/** One of the user's groups, with today's check-in in it (in the group's own timezone) if there is one. */
export interface WorkoutGroupState {
  name: string;
  requireCheckoutPhoto: boolean;
  minWorkoutMinutes: number;
  checkin: CheckinLike | null;
}

/**
 * What the lock-screen workout timer should show right now, or null when there should be none.
 *
 * A group is "pending" while it asks for a final photo and today's check-in there exists without
 * it (and is not older than what iOS keeps an activity alive). There is ONE timer for the whole
 * person, whichever groups are pending: it counts from the earliest pending check-in, shows the
 * HIGHEST minimum among them (so reaching it means the workout is long enough for every group —
 * and the minimum is informational only, it never removes a day's credit), and is labelled with
 * the group's name, or "N grupos" when several are waiting. No pending group means no activity —
 * which is also how a finished or deleted workout ends it.
 */
export function workoutActivityForGroups(input: { groups: WorkoutGroupState[]; now?: Date }): WorkoutActivityProps | null {
  const nowMs = (input.now ?? new Date()).getTime();
  const maxAgeMs = WORKOUT_ACTIVITY_MAX_AGE_HOURS * 60 * 60 * 1000;
  const pending = input.groups.flatMap((g) => {
    if (!g.requireCheckoutPhoto || !g.checkin || g.checkin.checkout_captured_at) return [];
    const startedMs = new Date(g.checkin.captured_at).getTime();
    const ageMs = nowMs - startedMs;
    if (Number.isNaN(startedMs) || ageMs < 0 || ageMs > maxAgeMs) return [];
    return [{ name: g.name, startedMs, startedAt: g.checkin.captured_at, min: Math.max(0, Math.floor(g.minWorkoutMinutes)) }];
  });
  if (pending.length === 0) return null;
  const earliest = pending.reduce((a, b) => (b.startedMs < a.startedMs ? b : a));
  return {
    startedAt: earliest.startedAt,
    minMinutes: Math.max(...pending.map((p) => p.min)),
    groupLabel: pending.length === 1 ? pending[0].name : `${pending.length} grupos`,
    checkoutUrl: WORKOUT_ACTIVITY_URL,
  };
}

export function sameWorkoutActivity(a: WorkoutActivityProps | null, b: WorkoutActivityProps | null): boolean {
  if (a === null || b === null) return a === b;
  return a.startedAt === b.startedAt && a.minMinutes === b.minMinutes && a.groupLabel === b.groupLabel;
}

export const WORKOUT_MILESTONE_IDS = {
  minReached: 'gymbuddies-workout-min-reached',
  endingSoon: 'gymbuddies-workout-ending-soon',
} as const;

export interface WorkoutMilestone {
  id: string;
  at: Date;
  body: string;
}

/**
 * The two local notifications that go with the timer, for the moments the Live Activity cannot
 * announce by itself (it has no server pushes): the group minimum being reached, and — 30 minutes
 * before iOS ends the activity — a nudge that the final photo is still missing. Only the ones
 * still in the future are returned, soonest first.
 */
export function workoutMilestones(props: WorkoutActivityProps, now: Date = new Date()): WorkoutMilestone[] {
  const startMs = new Date(props.startedAt).getTime();
  const milestones: WorkoutMilestone[] = [];
  if (props.minMinutes > 0) {
    milestones.push({
      id: WORKOUT_MILESTONE_IDS.minReached,
      at: new Date(startMs + props.minMinutes * 60 * 1000),
      body: `¡Ya cumpliste el mínimo de ${props.minMinutes} min! Toma tu foto final cuando termines.`,
    });
  }
  milestones.push({
    id: WORKOUT_MILESTONE_IDS.endingSoon,
    at: new Date(startMs + (WORKOUT_ACTIVITY_MAX_AGE_HOURS * 60 - WORKOUT_ENDING_SOON_LEAD_MINUTES) * 60 * 1000),
    body: 'Tu cronómetro está por terminar. No olvides tu foto final.',
  });
  return milestones.filter((m) => m.at.getTime() > now.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime());
}
