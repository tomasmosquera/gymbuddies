import {
  formatBogotaDateTime,
  getWeekBounds,
  isWithinClockDriftTolerance,
  nextMondayAfter,
  previousWeekBounds,
  toBogotaDateString,
  weekDates,
} from '@/lib/domain/dateUtils';

describe('weekDates', () => {
  it('returns all 7 Monday..Sunday dates for the given week start', () => {
    expect(weekDates('2026-07-13')).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]);
  });
});

describe('formatBogotaDateTime', () => {
  it('formats a UTC instant as DD/MM/YYYY HH:mm in Bogota local time', () => {
    expect(formatBogotaDateTime(new Date('2026-07-17T19:05:00Z'))).toBe('17/07/2026 14:05');
  });

  it('rolls over to the previous day when the UTC instant is before 05:00', () => {
    expect(formatBogotaDateTime(new Date('2026-07-17T02:00:00Z'))).toBe('16/07/2026 21:00');
  });
});

describe('toBogotaDateString', () => {
  it('converts a UTC instant to the correct America/Bogota calendar date', () => {
    // 2026-07-17T04:00:00Z is still 2026-07-16 in Bogota (UTC-5).
    expect(toBogotaDateString(new Date('2026-07-17T04:00:00Z'))).toBe('2026-07-16');
    // 2026-07-17T05:00:00Z is exactly 2026-07-17T00:00:00 in Bogota.
    expect(toBogotaDateString(new Date('2026-07-17T05:00:00Z'))).toBe('2026-07-17');
  });
});

describe('getWeekBounds', () => {
  it('returns the Monday..Sunday week containing the given date', () => {
    // 2026-07-17 is a Friday.
    expect(getWeekBounds(new Date('2026-07-17T12:00:00-05:00'))).toEqual({
      weekStart: '2026-07-13',
      weekEnd: '2026-07-19',
    });
  });

  it('treats Monday itself as the start of its own week', () => {
    expect(getWeekBounds(new Date('2026-07-13T00:00:00-05:00'))).toEqual({
      weekStart: '2026-07-13',
      weekEnd: '2026-07-19',
    });
  });

  it('treats Sunday as the end of the week it belongs to, not the next one', () => {
    expect(getWeekBounds(new Date('2026-07-19T23:59:00-05:00'))).toEqual({
      weekStart: '2026-07-13',
      weekEnd: '2026-07-19',
    });
  });
});

describe('previousWeekBounds', () => {
  it('returns last week when called at Monday 00:00 Bogota (the cron firing moment)', () => {
    // Monday 2026-07-20 00:00 Bogota == 2026-07-20T05:00:00Z.
    const result = previousWeekBounds(new Date('2026-07-20T05:00:00Z'));
    expect(result).toEqual({ weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  });
});

describe('nextMondayAfter', () => {
  it('returns the following Monday 00:00 Bogota for a mid-week instant', () => {
    // Wednesday 2026-07-15 in Bogota.
    const result = nextMondayAfter(new Date('2026-07-15T18:00:00-05:00'));
    expect(toBogotaDateString(result)).toBe('2026-07-20');
    expect(result.toISOString()).toBe('2026-07-20T05:00:00.000Z');
  });

  it('jumps a full week when called exactly at a Monday midnight boundary', () => {
    const monday = new Date('2026-07-20T05:00:00Z');
    const result = nextMondayAfter(monday);
    expect(result.toISOString()).toBe('2026-07-27T05:00:00.000Z');
  });
});

describe('isWithinClockDriftTolerance', () => {
  it('accepts a capture within the default 10 minute tolerance', () => {
    const now = new Date('2026-07-17T12:00:00Z');
    const captured = new Date('2026-07-17T11:55:00Z');
    expect(isWithinClockDriftTolerance(captured, now)).toBe(true);
  });

  it('rejects a capture reported far in the past or future', () => {
    const now = new Date('2026-07-17T12:00:00Z');
    expect(isWithinClockDriftTolerance(new Date('2026-07-17T11:00:00Z'), now)).toBe(false);
    expect(isWithinClockDriftTolerance(new Date('2026-07-17T13:00:00Z'), now)).toBe(false);
  });
});
