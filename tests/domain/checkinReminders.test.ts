import { shouldFireArrivalReminder } from '@/lib/domain/checkinReminders';

describe('shouldFireArrivalReminder', () => {
  it('fires when neither checked in nor reminded today', () => {
    expect(
      shouldFireArrivalReminder({ today: '2026-08-31', lastCheckinDateCached: null, lastReminderDateCached: null })
    ).toBe(true);
  });

  it('does not fire if already checked in today', () => {
    expect(
      shouldFireArrivalReminder({
        today: '2026-08-31',
        lastCheckinDateCached: '2026-08-31',
        lastReminderDateCached: null,
      })
    ).toBe(false);
  });

  it('does not fire if already reminded today (avoids spamming on repeated radius entries)', () => {
    expect(
      shouldFireArrivalReminder({
        today: '2026-08-31',
        lastCheckinDateCached: null,
        lastReminderDateCached: '2026-08-31',
      })
    ).toBe(false);
  });

  it('fires again on a new day even if yesterday had both a check-in and a reminder', () => {
    expect(
      shouldFireArrivalReminder({
        today: '2026-09-01',
        lastCheckinDateCached: '2026-08-31',
        lastReminderDateCached: '2026-08-31',
      })
    ).toBe(true);
  });
});
