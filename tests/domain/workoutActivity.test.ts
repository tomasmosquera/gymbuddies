import {
  WORKOUT_ACTIVITY_MAX_AGE_HOURS,
  WORKOUT_ACTIVITY_URL,
  WORKOUT_MILESTONE_IDS,
  sameWorkoutActivity,
  workoutActivityForGroups,
  workoutMilestones,
  type WorkoutGroupState,
} from '@/lib/domain/workoutActivity';

const NOW = new Date('2026-09-28T15:00:00Z');
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const group = (overrides: Partial<WorkoutGroupState> & { startedMinutesAgo?: number | null } = {}): WorkoutGroupState => {
  const { startedMinutesAgo = 20, ...rest } = overrides;
  return {
    name: 'Mis 59',
    requireCheckoutPhoto: true,
    minWorkoutMinutes: 45,
    checkin: startedMinutesAgo === null ? null : { captured_at: at(startedMinutesAgo), checkout_captured_at: null },
    ...rest,
  };
};
const run = (groups: WorkoutGroupState[]) => workoutActivityForGroups({ groups, now: NOW });

describe('workoutActivityForGroups — one group', () => {
  it('is up while a check-in waits for its final photo', () => {
    expect(run([group()])).toEqual({ startedAt: at(20), minMinutes: 45, groupLabel: 'Mis 59', checkoutUrl: WORKOUT_ACTIVITY_URL });
  });

  it('is gone once the final photo is in', () => {
    expect(run([group({ checkin: { captured_at: at(60), checkout_captured_at: at(5) } })])).toBeNull();
  });

  it('is gone when there is no check-in today (or it was deleted), and with no groups at all', () => {
    expect(run([group({ startedMinutesAgo: null })])).toBeNull();
    expect(run([])).toBeNull();
  });

  it('is never used for a group that does not ask for a final photo', () => {
    expect(run([group({ requireCheckoutPhoto: false })])).toBeNull();
  });

  it('is not restarted for a check-in older than what iOS keeps an activity alive', () => {
    expect(run([group({ startedMinutesAgo: WORKOUT_ACTIVITY_MAX_AGE_HOURS * 60 + 1 })])).toBeNull();
    expect(run([group({ startedMinutesAgo: WORKOUT_ACTIVITY_MAX_AGE_HOURS * 60 - 1 })])).not.toBeNull();
  });

  it('ignores a check-in dated in the future (clock skew)', () => {
    expect(run([group({ startedMinutesAgo: -30 })])).toBeNull();
  });

  it('carries "no minimum" as 0 and never a negative or fractional number', () => {
    expect(run([group({ minWorkoutMinutes: 0 })])?.minMinutes).toBe(0);
    expect(run([group({ minWorkoutMinutes: -3.7 })])?.minMinutes).toBe(0);
    expect(run([group({ minWorkoutMinutes: 30.9 })])?.minMinutes).toBe(30);
  });
});

describe('workoutActivityForGroups — several groups', () => {
  it('shows ONE timer with the highest minimum among the pending groups, labelled "N grupos"', () => {
    const props = run([group({ name: 'A', minWorkoutMinutes: 30 }), group({ name: 'B', minWorkoutMinutes: 45 })]);
    expect(props?.minMinutes).toBe(45);
    expect(props?.groupLabel).toBe('2 grupos');
  });

  it('counts from the earliest pending check-in', () => {
    const props = run([group({ startedMinutesAgo: 10 }), group({ startedMinutesAgo: 25 })]);
    expect(props?.startedAt).toBe(at(25));
  });

  it('only counts groups that are still waiting: a finished, absent or no-final-photo group does not count', () => {
    const props = run([
      group({ name: 'Pendiente', minWorkoutMinutes: 30 }),
      group({ name: 'Ya terminó', minWorkoutMinutes: 90, checkin: { captured_at: at(50), checkout_captured_at: at(2) } }),
      group({ name: 'Sin check-in', minWorkoutMinutes: 90, startedMinutesAgo: null }),
      group({ name: 'Sin foto final', minWorkoutMinutes: 90, requireCheckoutPhoto: false }),
    ]);
    expect(props?.minMinutes).toBe(30);
    expect(props?.groupLabel).toBe('Pendiente'); // one pending group: its own name, not "N grupos"
  });

  it('is gone once every group has its final photo', () => {
    const done = { captured_at: at(50), checkout_captured_at: at(2) };
    expect(run([group({ checkin: done }), group({ checkin: done })])).toBeNull();
  });
});

describe('sameWorkoutActivity', () => {
  const a = { startedAt: at(20), minMinutes: 45, groupLabel: 'Mis 59', checkoutUrl: WORKOUT_ACTIVITY_URL };
  it('compares by content, treating null as "no activity"', () => {
    expect(sameWorkoutActivity(a, { ...a })).toBe(true);
    expect(sameWorkoutActivity(a, { ...a, startedAt: at(10) })).toBe(false);
    expect(sameWorkoutActivity(a, { ...a, minMinutes: 30 })).toBe(false);
    expect(sameWorkoutActivity(a, { ...a, groupLabel: '2 grupos' })).toBe(false);
    expect(sameWorkoutActivity(null, null)).toBe(true);
    expect(sameWorkoutActivity(a, null)).toBe(false);
  });
});

describe('workoutMilestones', () => {
  const props = (minMinutes: number) => ({ startedAt: at(10), minMinutes, groupLabel: 'Mis 59', checkoutUrl: WORKOUT_ACTIVITY_URL });

  it('schedules "minimum reached" at check-in + minimum, and "ending soon" 30 min before iOS ends the activity', () => {
    const [minReached, endingSoon] = workoutMilestones(props(45), NOW);
    expect(minReached.id).toBe(WORKOUT_MILESTONE_IDS.minReached);
    expect(minReached.at.getTime()).toBe(new Date(at(10)).getTime() + 45 * 60_000);
    expect(minReached.body).toContain('45 min');
    expect(endingSoon.id).toBe(WORKOUT_MILESTONE_IDS.endingSoon);
    expect(endingSoon.at.getTime()).toBe(new Date(at(10)).getTime() + (8 * 60 - 30) * 60_000);
  });

  it('has no "minimum reached" when the group has no minimum', () => {
    expect(workoutMilestones(props(0), NOW).map((m) => m.id)).toEqual([WORKOUT_MILESTONE_IDS.endingSoon]);
  });

  it('drops the milestones already in the past', () => {
    const late = { ...props(45), startedAt: at(60) }; // 60 min in: the 45-minute mark is behind us
    expect(workoutMilestones(late, NOW).map((m) => m.id)).toEqual([WORKOUT_MILESTONE_IDS.endingSoon]);
    const veryLate = { ...props(45), startedAt: at(7 * 60 + 40) }; // 7 h 40 in: both are behind us
    expect(workoutMilestones(veryLate, NOW)).toEqual([]);
  });

  it('returns them soonest first', () => {
    const ms = workoutMilestones(props(45), NOW);
    expect(ms.map((m) => m.at.getTime())).toEqual([...ms.map((m) => m.at.getTime())].sort((x, y) => x - y));
  });
});

describe('the deep link', () => {
  it('points at the check-in tab, in the final-photo step', () => {
    expect(WORKOUT_ACTIVITY_URL).toBe('gymbuddies://checkin?checkout=1');
  });
});
