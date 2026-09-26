import {
  canCancelEarlyClose,
  canCloseEarly,
  cycleBoundaryDate,
  dateOnlyToLocalDate,
  earlyCloseSunday,
} from '@/lib/domain/leagueCycle';
import type { LeagueCycle } from '@/lib/supabase/types';

const TZ = 'America/Bogota'; // UTC-5, no DST

// 13-week cycle: Monday 2026-08-17 00:00 Bogotá .. Sunday 2026-11-15 23:59:59 Bogotá
const cycle = (overrides: Partial<LeagueCycle> = {}): LeagueCycle => ({
  id: 'c1',
  group_id: 'g1',
  cycle_number: 1,
  prize_splits: [60, 30, 10],
  duration_weeks: 13,
  league_share_percent: 100,
  started_at: '2026-08-17T05:00:00+00:00',
  ends_at: '2026-11-16T04:59:59+00:00',
  effective_start_date: '2026-08-17',
  closed_early: false,
  original_ends_at: null,
  status: 'running',
  completed_at: null,
  pool_at_payout: null,
  created_at: '2026-08-10T12:00:00+00:00',
  ...overrides,
});

describe('cycleBoundaryDate', () => {
  it('reads the end instant as the Sunday it is in the GROUP timezone, not the device or UTC one', () => {
    expect(cycleBoundaryDate('2026-11-16T04:59:59+00:00', TZ)).toBe('2026-11-15');
    expect(cycleBoundaryDate('2026-11-16T04:59:59+00:00', 'UTC')).toBe('2026-11-16');
  });
});

describe('earlyCloseSunday', () => {
  it('is the Sunday of the current Monday-Sunday week', () => {
    expect(earlyCloseSunday(new Date('2026-09-25T15:00:00Z'), TZ)).toBe('2026-09-27'); // Friday
    expect(earlyCloseSunday(new Date('2026-09-27T20:00:00Z'), TZ)).toBe('2026-09-27'); // Sunday itself
    expect(earlyCloseSunday(new Date('2026-09-28T06:00:00Z'), TZ)).toBe('2026-10-04'); // Monday 01:00 Bogotá is already the next week
  });
});

describe('canCloseEarly', () => {
  it('is allowed in the middle of a cycle', () => {
    expect(canCloseEarly(cycle(), new Date('2026-09-25T15:00:00Z'), TZ)).toBe(true);
  });

  it('is pointless in the cycle\'s last week (it already ends this Sunday)', () => {
    expect(canCloseEarly(cycle(), new Date('2026-11-12T15:00:00Z'), TZ)).toBe(false);
  });

  it('is not offered before the cycle has started', () => {
    expect(canCloseEarly(cycle(), new Date('2026-08-12T15:00:00Z'), TZ)).toBe(false);
  });

  it('is not offered twice, nor for a cycle that is not running', () => {
    expect(canCloseEarly(cycle({ closed_early: true }), new Date('2026-09-25T15:00:00Z'), TZ)).toBe(false);
    expect(canCloseEarly(cycle({ status: 'completed' }), new Date('2026-09-25T15:00:00Z'), TZ)).toBe(false);
  });

  it('is allowed in the first week of the cycle', () => {
    expect(canCloseEarly(cycle(), new Date('2026-08-19T15:00:00Z'), TZ)).toBe(true);
  });
});

describe('canCancelEarlyClose', () => {
  const closed = cycle({ closed_early: true, ends_at: '2026-09-28T04:59:59+00:00', original_ends_at: '2026-11-16T04:59:59+00:00' });

  it('is possible while the closing week is still going', () => {
    expect(canCancelEarlyClose(closed, new Date('2026-09-27T20:00:00Z'))).toBe(true);
  });

  it('is not possible once the closing week is over, even before the Monday settlement', () => {
    expect(canCancelEarlyClose(closed, new Date('2026-09-28T05:30:00Z'))).toBe(false);
  });

  it('is not possible on a cycle that was not closed early', () => {
    expect(canCancelEarlyClose(cycle(), new Date('2026-09-25T15:00:00Z'))).toBe(false);
  });
});

describe('dateOnlyToLocalDate', () => {
  it('keeps the calendar day whatever the device timezone', () => {
    const d = dateOnlyToLocalDate('2026-09-23');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 23]);
  });
});
