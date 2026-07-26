import {
  averageCheckinHour,
  averageDurationByMonth,
  averageDurationByWeek,
  buildHeatmapWeeks,
  checkinHourBuckets,
  formatHour,
  weekdayCompletionRates,
  weeklyConsistency,
} from '@/lib/domain/personalStats';
import type { BadgeCheckinFact, BadgeDayRecord } from '@/lib/domain/badges';

function days(spec: [string, BadgeDayRecord['status']][]): BadgeDayRecord[] {
  return spec.map(([date, status]) => ({ date, status }));
}

function checkins(spec: [string, number, number | null][]): BadgeCheckinFact[] {
  return spec.map(([date, hourBogota, workoutMinutes]) => ({ date, hourBogota, workoutMinutes }));
}

describe('weekdayCompletionRates', () => {
  it('tallies completed/failed per weekday, ignoring excused days', () => {
    const rates = weekdayCompletionRates(
      days([
        // Monday 2026-07-20
        ['2026-07-20', 'completed'],
        ['2026-07-27', 'failed'],
        // Tuesday 2026-07-21
        ['2026-07-21', 'excused'],
      ])
    );
    const monday = rates.find((r) => r.weekday === 0)!;
    expect(monday.completed).toBe(1);
    expect(monday.failed).toBe(1);
    expect(monday.percent).toBe(50);

    const tuesday = rates.find((r) => r.weekday === 1)!;
    expect(tuesday.completed).toBe(0);
    expect(tuesday.failed).toBe(0);
    expect(tuesday.percent).toBeNull();
  });

  it('has all 7 weekdays even with no data', () => {
    expect(weekdayCompletionRates([])).toHaveLength(7);
  });
});

describe('checkinHourBuckets', () => {
  it('buckets check-ins into madrugada/mañana/tarde/noche', () => {
    const buckets = checkinHourBuckets(
      checkins([
        ['2026-07-20', 3, null],
        ['2026-07-21', 7, null],
        ['2026-07-22', 14, null],
        ['2026-07-23', 20, null],
        ['2026-07-24', 20, null],
      ])
    );
    expect(buckets.find((b) => b.label === 'Madrugada')?.count).toBe(1);
    expect(buckets.find((b) => b.label === 'Mañana')?.count).toBe(1);
    expect(buckets.find((b) => b.label === 'Tarde')?.count).toBe(1);
    expect(buckets.find((b) => b.label === 'Noche')?.count).toBe(2);
  });
});

describe('averageCheckinHour', () => {
  it('averages hourBogota across all check-ins', () => {
    expect(averageCheckinHour(checkins([['2026-07-20', 6, null], ['2026-07-21', 8, null]]))).toBe(7);
  });

  it('is null with no check-ins', () => {
    expect(averageCheckinHour([])).toBeNull();
  });
});

describe('formatHour', () => {
  it('formats fractional hours as 12-hour clock strings', () => {
    expect(formatHour(6.5)).toBe('6:30 a.m.');
    expect(formatHour(0)).toBe('12:00 a.m.');
    expect(formatHour(13)).toBe('1:00 p.m.');
    expect(formatHour(12)).toBe('12:00 p.m.');
  });
});

describe('averageDurationByMonth', () => {
  it('averages workout minutes per month, skipping null durations and empty months', () => {
    const result = averageDurationByMonth(
      checkins([
        ['2026-06-01', 7, 30],
        ['2026-06-05', 7, null],
        ['2026-06-10', 7, 50],
        ['2026-07-01', 7, 40],
      ])
    );
    expect(result).toEqual([
      { month: '2026-06', avgMinutes: 40, sessions: 2 },
      { month: '2026-07', avgMinutes: 40, sessions: 1 },
    ]);
  });
});

describe('weeklyConsistency', () => {
  it('groups days by Monday-start week, ignoring excused days', () => {
    const result = weeklyConsistency(
      days([
        ['2026-07-20', 'completed'], // Monday, week of 2026-07-20
        ['2026-07-21', 'failed'], // Tuesday, same week
        ['2026-07-22', 'excused'], // Wednesday, same week — ignored
        ['2026-07-27', 'completed'], // Monday, next week
      ])
    );
    expect(result).toEqual([
      { weekStart: '2026-07-20', completed: 1, failed: 1, percent: 50 },
      { weekStart: '2026-07-27', completed: 1, failed: 0, percent: 100 },
    ]);
  });
});

describe('averageDurationByWeek', () => {
  it('averages workout minutes per Monday-start week', () => {
    const result = averageDurationByWeek(
      checkins([
        ['2026-07-20', 7, 30],
        ['2026-07-21', 7, 50],
        ['2026-07-27', 7, 40],
      ])
    );
    expect(result).toEqual([
      { weekStart: '2026-07-20', avgMinutes: 40, sessions: 2 },
      { weekStart: '2026-07-27', avgMinutes: 40, sessions: 1 },
    ]);
  });
});

describe('buildHeatmapWeeks', () => {
  it('returns weeksToShow weeks of 7 days each, aligned to the current week', () => {
    const weeks = buildHeatmapWeeks(days([['2026-07-20', 'completed']]), '2026-07-24', 4);
    expect(weeks).toHaveLength(4);
    for (const week of weeks) expect(week).toHaveLength(7);
    // 2026-07-20 is the Monday of the week containing 2026-07-24 — last week, first cell.
    expect(weeks[3][0]).toEqual({ date: '2026-07-20', status: 'completed' });
  });

  it('nulls out dates after today and dates with no tracked status', () => {
    const weeks = buildHeatmapWeeks([], '2026-07-24', 1);
    // Friday 2026-07-24 (today, index 4) has no tracked status; Saturday/Sunday
    // (indices 5-6) are still in the future within this same week.
    expect(weeks[0][4]).toBeNull();
    expect(weeks[0][5]).toBeNull();
    expect(weeks[0][6]).toBeNull();
  });
});
