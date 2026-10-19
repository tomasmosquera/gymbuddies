import { computeWeekStreak } from '@/lib/domain/workoutStreak';

describe('computeWeekStreak', () => {
  it('counts this week when it already has a session', () => {
    // Monday 2026-10-12..Sunday 2026-10-18 is "this week" for today = 2026-10-15 (Thursday).
    expect(computeWeekStreak(['2026-10-15'], '2026-10-15')).toBe(1);
  });

  it('counts an unbroken run of prior weeks even when this week is still empty', () => {
    expect(computeWeekStreak(['2026-10-01', '2026-10-08'], '2026-10-15')).toBe(2);
  });

  it('stops at the first missing week looking backward', () => {
    expect(computeWeekStreak(['2026-10-08', '2026-09-24'], '2026-10-15')).toBe(1);
  });

  it('returns 0 with no sessions at all', () => {
    expect(computeWeekStreak([], '2026-10-15')).toBe(0);
  });

  it('counts multiple sessions in the same week only once', () => {
    expect(computeWeekStreak(['2026-10-13', '2026-10-15', '2026-10-17'], '2026-10-15')).toBe(1);
  });

  it('a longer unbroken run counts every week', () => {
    expect(computeWeekStreak(['2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15'], '2026-10-16')).toBe(4);
  });
});
