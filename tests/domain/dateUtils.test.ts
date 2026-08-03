import {
  enumerateDates,
  enumerateMonths,
  formatElapsedClock,
  formatZonedDateTime12h,
  formatZonedTime12h,
  getWeekBounds,
  getWeekBoundsForDateString,
  isWithinClockDriftTolerance,
  nextMondayAfter,
  previousWeekBounds,
  toZonedDateString,
  toZonedHour,
  weekDates,
} from '@/lib/domain/dateUtils';

const BOGOTA = 'America/Bogota';
const MEXICO_CITY = 'America/Mexico_City'; // UTC-6, no DST — 1h behind Bogota
const SHANGHAI = 'Asia/Shanghai'; // UTC+8, no DST — 13h ahead of Bogota
const NEW_YORK = 'America/New_York'; // UTC-5/-4, DOES observe DST

describe('formatElapsedClock', () => {
  it('shows MM:SS under an hour', () => {
    expect(formatElapsedClock(65)).toBe('01:05');
    expect(formatElapsedClock(0)).toBe('00:00');
  });

  it('shows H:MM:SS once past an hour', () => {
    expect(formatElapsedClock(3725)).toBe('1:02:05');
  });
});

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

describe('enumerateDates', () => {
  it('returns every date inclusive, ascending', () => {
    expect(enumerateDates('2026-07-30', '2026-08-02')).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('returns a single-element array when start equals end', () => {
    expect(enumerateDates('2026-07-30', '2026-07-30')).toEqual(['2026-07-30']);
  });

  it('returns an empty array when start is after end', () => {
    expect(enumerateDates('2026-08-01', '2026-07-30')).toEqual([]);
  });
});

describe('enumerateMonths', () => {
  it('returns every month key inclusive, ascending, across a year boundary', () => {
    expect(enumerateMonths('2025-11-15', '2026-02-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('returns a single-element array when start and end are in the same month', () => {
    expect(enumerateMonths('2026-07-01', '2026-07-30')).toEqual(['2026-07']);
  });

  it('returns an empty array when start is after end', () => {
    expect(enumerateMonths('2026-08-01', '2026-07-01')).toEqual([]);
  });
});

describe('formatZonedDateTime12h', () => {
  it('formats a UTC instant as DD/MM/YYYY with a zero-padded 12-hour clock in Bogota local time', () => {
    expect(formatZonedDateTime12h(new Date('2026-07-17T19:05:00Z'), BOGOTA)).toBe('17/07/2026 02:05 pm');
  });

  it('rolls over to the previous day when the UTC instant is before 05:00 Bogota', () => {
    expect(formatZonedDateTime12h(new Date('2026-07-17T02:00:00Z'), BOGOTA)).toBe('16/07/2026 09:00 pm');
  });

  it('formats the same instant differently for a group in Shanghai (UTC+8)', () => {
    // 2026-07-17T19:05:00Z is already 2026-07-18 03:05 am in Shanghai.
    expect(formatZonedDateTime12h(new Date('2026-07-17T19:05:00Z'), SHANGHAI)).toBe('18/07/2026 03:05 am');
  });
});

describe('formatZonedTime12h', () => {
  it('formats afternoon and morning instants as zero-padded 12-hour time in Bogota', () => {
    expect(formatZonedTime12h(new Date('2026-07-17T19:05:00Z'), BOGOTA)).toBe('02:05 pm');
    expect(formatZonedTime12h(new Date('2026-07-17T14:30:00Z'), BOGOTA)).toBe('09:30 am');
  });

  it('shows midnight as 12:00 am and noon as 12:00 pm', () => {
    expect(formatZonedTime12h(new Date('2026-07-17T05:00:00Z'), BOGOTA)).toBe('12:00 am');
    expect(formatZonedTime12h(new Date('2026-07-17T17:00:00Z'), BOGOTA)).toBe('12:00 pm');
  });

  it('formats correctly for Mexico City (UTC-6, 1h behind Bogota)', () => {
    // 2026-07-17T05:00:00Z is midnight in Bogota but still 11pm the prior day in Mexico City.
    expect(formatZonedTime12h(new Date('2026-07-17T05:00:00Z'), MEXICO_CITY)).toBe('11:00 pm');
  });
});

describe('toZonedDateString', () => {
  it('converts a UTC instant to the correct America/Bogota calendar date', () => {
    // 2026-07-17T04:00:00Z is still 2026-07-16 in Bogota (UTC-5).
    expect(toZonedDateString(new Date('2026-07-17T04:00:00Z'), BOGOTA)).toBe('2026-07-16');
    // 2026-07-17T05:00:00Z is exactly 2026-07-17T00:00:00 in Bogota.
    expect(toZonedDateString(new Date('2026-07-17T05:00:00Z'), BOGOTA)).toBe('2026-07-17');
  });

  it('lands on a different calendar day entirely for Shanghai vs Bogota for the same instant', () => {
    // 2026-07-16T20:00:00Z is 2026-07-16 in Bogota but already 2026-07-17 04:00 in Shanghai.
    expect(toZonedDateString(new Date('2026-07-16T20:00:00Z'), BOGOTA)).toBe('2026-07-16');
    expect(toZonedDateString(new Date('2026-07-16T20:00:00Z'), SHANGHAI)).toBe('2026-07-17');
  });

  it('correctly reflects a DST-observing zone (New York) on both sides of the spring-forward transition', () => {
    // 2026-03-08 is the US spring-forward date; New York is UTC-5 before, UTC-4 after 07:00 UTC.
    expect(toZonedDateString(new Date('2026-03-08T04:30:00Z'), NEW_YORK)).toBe('2026-03-07'); // still UTC-5 (11:30pm Mar 7)
    expect(toZonedDateString(new Date('2026-03-08T05:30:00Z'), NEW_YORK)).toBe('2026-03-08'); // now UTC-4 (01:30am Mar 8)
  });
});

describe('toZonedHour', () => {
  it('converts a UTC instant to the correct America/Bogota hour', () => {
    expect(toZonedHour(new Date('2026-07-17T11:00:00Z'), BOGOTA)).toBe(6);
  });

  it('rolls over past midnight correctly', () => {
    expect(toZonedHour(new Date('2026-07-17T04:30:00Z'), BOGOTA)).toBe(23);
  });
});

describe('getWeekBounds', () => {
  it('returns the Monday..Sunday week containing the given date in Bogota', () => {
    // 2026-07-17 is a Friday.
    expect(getWeekBounds(new Date('2026-07-17T12:00:00-05:00'), BOGOTA)).toEqual({
      weekStart: '2026-07-13',
      weekEnd: '2026-07-19',
    });
  });

  it('treats Monday itself as the start of its own week', () => {
    expect(getWeekBounds(new Date('2026-07-13T00:00:00-05:00'), BOGOTA)).toEqual({
      weekStart: '2026-07-13',
      weekEnd: '2026-07-19',
    });
  });

  it('treats Sunday as the end of the week it belongs to, not the next one', () => {
    expect(getWeekBounds(new Date('2026-07-19T23:59:00-05:00'), BOGOTA)).toEqual({
      weekStart: '2026-07-13',
      weekEnd: '2026-07-19',
    });
  });

  it('can land in a different week than Bogota for the same instant, close to the local day boundary', () => {
    // 2026-07-20T05:30:00Z is 00:30 Monday in Bogota (UTC-5, week just rolled
    // over) but still 23:30 Sunday the day before in Mexico City (UTC-6,
    // still the previous week) — a 1-hour-behind group hasn't hit its own
    // midnight yet even though Bogota already has.
    const instant = new Date('2026-07-20T05:30:00Z');
    expect(getWeekBounds(instant, BOGOTA)).toEqual({ weekStart: '2026-07-20', weekEnd: '2026-07-26' });
    expect(getWeekBounds(instant, MEXICO_CITY)).toEqual({ weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  });
});

describe('getWeekBoundsForDateString', () => {
  it('matches getWeekBounds for a mid-week date', () => {
    expect(getWeekBoundsForDateString('2026-07-17')).toEqual({ weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  });

  // Regression: `new Date(`${date}T00:00:00Z`)` is midnight UTC, which a
  // real zone shift could reinterpret as the *previous* local day — silently
  // landing a Monday in the week before. This is exactly why
  // getWeekBoundsForDateString works purely on the calendar-date string
  // instead of ever re-deriving it from an instant.
  it('does not shift a Monday date string back into the previous week', () => {
    expect(getWeekBoundsForDateString('2026-07-20')).toEqual({ weekStart: '2026-07-20', weekEnd: '2026-07-26' });
  });
});

describe('previousWeekBounds', () => {
  it('returns last week when called at Monday 00:00 Bogota (the cron firing moment)', () => {
    // Monday 2026-07-20 00:00 Bogota == 2026-07-20T05:00:00Z.
    const result = previousWeekBounds(new Date('2026-07-20T05:00:00Z'), BOGOTA);
    expect(result).toEqual({ weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  });

  it('returns last week when called at Monday 00:00 Shanghai — a completely different real-world instant than Bogota\'s', () => {
    // Monday 2026-07-20 00:00 Shanghai (UTC+8) == 2026-07-19T16:00:00Z.
    const result = previousWeekBounds(new Date('2026-07-19T16:00:00Z'), SHANGHAI);
    expect(result).toEqual({ weekStart: '2026-07-13', weekEnd: '2026-07-19' });
  });
});

describe('nextMondayAfter', () => {
  it('returns the following Monday 00:00 Bogota for a mid-week instant', () => {
    // Wednesday 2026-07-15 in Bogota.
    const result = nextMondayAfter(new Date('2026-07-15T18:00:00-05:00'), BOGOTA);
    expect(toZonedDateString(result, BOGOTA)).toBe('2026-07-20');
    expect(result.toISOString()).toBe('2026-07-20T05:00:00.000Z');
  });

  it('jumps a full week when called exactly at a Monday midnight boundary', () => {
    const monday = new Date('2026-07-20T05:00:00Z');
    const result = nextMondayAfter(monday, BOGOTA);
    expect(result.toISOString()).toBe('2026-07-27T05:00:00.000Z');
  });

  it('resolves to a different real-world UTC instant for a Shanghai group than a Bogota group', () => {
    const midweek = new Date('2026-07-15T18:00:00-05:00'); // Wednesday, Bogota afternoon
    const bogotaResult = nextMondayAfter(midweek, BOGOTA);
    const shanghaiResult = nextMondayAfter(midweek, SHANGHAI);
    expect(bogotaResult.toISOString()).toBe('2026-07-20T05:00:00.000Z');
    // Shanghai's Monday 00:00 is 13 hours earlier in UTC than Bogota's.
    expect(shanghaiResult.toISOString()).toBe('2026-07-19T16:00:00.000Z');
  });
});

describe('isWithinClockDriftTolerance', () => {
  it('accepts a capture within the default 4 hour tolerance', () => {
    const now = new Date('2026-07-17T12:00:00Z');
    const captured = new Date('2026-07-17T11:55:00Z');
    expect(isWithinClockDriftTolerance(captured, now)).toBe(true);
  });

  it('accepts a realistic checkout gap — a long workout plus time to walk out, wait for GPS, and review the photo before confirming', () => {
    const now = new Date('2026-07-17T12:00:00Z');
    const captured = new Date('2026-07-17T08:30:00Z'); // 3.5 hours earlier
    expect(isWithinClockDriftTolerance(captured, now)).toBe(true);
  });

  it('rejects a capture reported far in the past or future', () => {
    const now = new Date('2026-07-17T12:00:00Z');
    expect(isWithinClockDriftTolerance(new Date('2026-07-17T06:00:00Z'), now)).toBe(false); // 6 hours earlier
    expect(isWithinClockDriftTolerance(new Date('2026-07-17T18:00:00Z'), now)).toBe(false); // 6 hours later
  });

  it('is unaffected by timezone — it only ever compares absolute instants', () => {
    // Same two instants as the first case above; nothing timezone-related to pass here at all.
    const now = new Date('2026-07-17T12:00:00Z');
    const captured = new Date('2026-07-17T11:55:00Z');
    expect(isWithinClockDriftTolerance(captured, now, 14400)).toBe(true);
  });
});
