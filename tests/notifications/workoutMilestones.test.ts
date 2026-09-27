import { WORKOUT_ACTIVITY_URL, WORKOUT_MILESTONE_IDS, type WorkoutActivityProps } from '@/lib/domain/workoutActivity';
import { syncWorkoutMilestoneNotifications } from '@/lib/notifications/workoutMilestones';

const mockSchedule = jest.fn().mockResolvedValue('id');
const mockCancel = jest.fn().mockResolvedValue(undefined);
let mockRemindersEnabled = true;

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: (...args: unknown[]) => mockSchedule(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancel(...args),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('@/lib/notifications/reminderPreference', () => ({
  getRemindersEnabledCache: () => Promise.resolve(mockRemindersEnabled),
}));

const NOW = new Date('2026-09-28T15:00:00Z');
const props = (minutesAgo: number, minMinutes = 45): WorkoutActivityProps => ({
  startedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  minMinutes,
  groupLabel: 'Mis 59',
  checkoutUrl: WORKOUT_ACTIVITY_URL,
});

beforeEach(() => {
  mockSchedule.mockClear();
  mockCancel.mockClear();
  mockRemindersEnabled = true;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('syncWorkoutMilestoneNotifications', () => {
  it('replaces whatever was scheduled and sets up both notifications for a fresh workout', async () => {
    await syncWorkoutMilestoneNotifications(props(10), NOW);
    expect(mockCancel).toHaveBeenCalledWith(WORKOUT_MILESTONE_IDS.minReached);
    expect(mockCancel).toHaveBeenCalledWith(WORKOUT_MILESTONE_IDS.endingSoon);
    const ids = mockSchedule.mock.calls.map((c) => c[0].identifier);
    expect(ids).toEqual([WORKOUT_MILESTONE_IDS.minReached, WORKOUT_MILESTONE_IDS.endingSoon]);
    const first = mockSchedule.mock.calls[0][0];
    expect(first.trigger.type).toBe('date');
    expect(first.trigger.date.getTime()).toBe(new Date(props(10).startedAt).getTime() + 45 * 60_000);
    expect(first.content.body).toContain('mínimo');
  });

  it('clears both and schedules nothing when the workout is over', async () => {
    await syncWorkoutMilestoneNotifications(null, NOW);
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('respects the Recordatorios switch: cancels but does not schedule', async () => {
    mockRemindersEnabled = false;
    await syncWorkoutMilestoneNotifications(props(10), NOW);
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('never throws when the notification system fails', async () => {
    mockSchedule.mockRejectedValueOnce(new Error('notifications are not permitted'));
    await expect(syncWorkoutMilestoneNotifications(props(10), NOW)).resolves.toBeUndefined();
  });
});
