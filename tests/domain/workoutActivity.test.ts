import {
  WORKOUT_ACTIVITY_MAX_AGE_HOURS,
  WORKOUT_ACTIVITY_URL,
  sameWorkoutActivity,
  workoutActivityFor,
} from '@/lib/domain/workoutActivity';

const NOW = new Date('2026-09-28T15:00:00Z');
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
const base = { requireCheckoutPhoto: true, minWorkoutMinutes: 45, groupName: 'Mis 59', now: NOW };

describe('workoutActivityFor', () => {
  it('is up while a check-in waits for its final photo', () => {
    const props = workoutActivityFor({ ...base, checkin: { captured_at: at(20), checkout_captured_at: null } });
    expect(props).toEqual({ startedAt: at(20), minMinutes: 45, groupName: 'Mis 59', checkoutUrl: WORKOUT_ACTIVITY_URL });
  });

  it('is gone once the final photo is in', () => {
    expect(workoutActivityFor({ ...base, checkin: { captured_at: at(60), checkout_captured_at: at(5) } })).toBeNull();
  });

  it('is gone when there is no check-in today (or it was deleted)', () => {
    expect(workoutActivityFor({ ...base, checkin: null })).toBeNull();
  });

  it('is never used for a group that does not ask for a final photo', () => {
    expect(
      workoutActivityFor({ ...base, requireCheckoutPhoto: false, checkin: { captured_at: at(20), checkout_captured_at: null } })
    ).toBeNull();
  });

  it('is not restarted for a check-in older than what iOS keeps an activity alive', () => {
    const tooOld = at(WORKOUT_ACTIVITY_MAX_AGE_HOURS * 60 + 1);
    expect(workoutActivityFor({ ...base, checkin: { captured_at: tooOld, checkout_captured_at: null } })).toBeNull();
    const justInside = at(WORKOUT_ACTIVITY_MAX_AGE_HOURS * 60 - 1);
    expect(workoutActivityFor({ ...base, checkin: { captured_at: justInside, checkout_captured_at: null } })).not.toBeNull();
  });

  it('ignores a check-in dated in the future (clock skew)', () => {
    expect(workoutActivityFor({ ...base, checkin: { captured_at: at(-30), checkout_captured_at: null } })).toBeNull();
  });

  it('carries "no minimum" as 0 and never a negative or fractional number', () => {
    const none = workoutActivityFor({ ...base, minWorkoutMinutes: 0, checkin: { captured_at: at(5), checkout_captured_at: null } });
    expect(none?.minMinutes).toBe(0);
    const odd = workoutActivityFor({ ...base, minWorkoutMinutes: -3.7, checkin: { captured_at: at(5), checkout_captured_at: null } });
    expect(odd?.minMinutes).toBe(0);
    const frac = workoutActivityFor({ ...base, minWorkoutMinutes: 30.9, checkin: { captured_at: at(5), checkout_captured_at: null } });
    expect(frac?.minMinutes).toBe(30);
  });
});

describe('sameWorkoutActivity', () => {
  const a = { startedAt: at(20), minMinutes: 45, groupName: 'Mis 59', checkoutUrl: WORKOUT_ACTIVITY_URL };
  it('compares by content, treating null as "no activity"', () => {
    expect(sameWorkoutActivity(a, { ...a })).toBe(true);
    expect(sameWorkoutActivity(a, { ...a, startedAt: at(10) })).toBe(false);
    expect(sameWorkoutActivity(a, { ...a, minMinutes: 30 })).toBe(false);
    expect(sameWorkoutActivity(null, null)).toBe(true);
    expect(sameWorkoutActivity(a, null)).toBe(false);
  });
});

describe('the deep link', () => {
  it('points at the check-in tab, in the final-photo step', () => {
    expect(WORKOUT_ACTIVITY_URL).toBe('gymbuddies://checkin?checkout=1');
  });
});
