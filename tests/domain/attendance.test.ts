import {
  classifyMemberDay,
  consistencyPercent,
  determineTopRanked,
  rankMembersByConsistency,
  tallyAttendance,
} from '@/lib/domain/attendance';

describe('classifyMemberDay', () => {
  it('is completed with a check-in and nothing else', () => {
    expect(
      classifyMemberDay({ hasCheckin: true, hasValidOverride: false, hasFailedOverride: false, isExcused: false })
    ).toBe('completed');
  });

  it('is completed via a valid override with no check-in at all', () => {
    expect(
      classifyMemberDay({ hasCheckin: false, hasValidOverride: true, hasFailedOverride: false, isExcused: false })
    ).toBe('completed');
  });

  it('a failed override always wins, even over a real check-in', () => {
    expect(
      classifyMemberDay({ hasCheckin: true, hasValidOverride: false, hasFailedOverride: true, isExcused: false })
    ).toBe('failed');
  });

  it('is excused when nothing else applies', () => {
    expect(
      classifyMemberDay({ hasCheckin: false, hasValidOverride: false, hasFailedOverride: false, isExcused: true })
    ).toBe('excused');
  });

  it('being excused wins over a failed override — matches the existing dashboard logic exactly (excused is checked after, but independently of, the failed-override gate)', () => {
    expect(
      classifyMemberDay({ hasCheckin: false, hasValidOverride: false, hasFailedOverride: true, isExcused: true })
    ).toBe('excused');
  });

  it('is failed when nothing is present at all', () => {
    expect(
      classifyMemberDay({ hasCheckin: false, hasValidOverride: false, hasFailedOverride: false, isExcused: false })
    ).toBe('failed');
  });
});

describe('tallyAttendance', () => {
  it('returns all zeros for an empty list', () => {
    expect(tallyAttendance([])).toEqual({ completedCount: 0, excusedCount: 0, failedCount: 0, decidedDays: 0 });
  });

  it('tallies a mix and computes decidedDays as completed + failed (excused excluded)', () => {
    const result = tallyAttendance(['completed', 'completed', 'excused', 'failed', 'completed', 'failed']);
    expect(result).toEqual({ completedCount: 3, excusedCount: 1, failedCount: 2, decidedDays: 5 });
  });
});

describe('consistencyPercent', () => {
  it('is null with no decided days', () => {
    expect(consistencyPercent(0, 0)).toBeNull();
  });

  it('rounds completed / (completed + failed)', () => {
    expect(consistencyPercent(2, 1)).toBe(67);
    expect(consistencyPercent(0, 3)).toBe(0);
    expect(consistencyPercent(3, 0)).toBe(100);
  });
});

describe('rankMembersByConsistency', () => {
  it('ranks by percent alone when duration tiebreak is off, sharing ties', () => {
    const rank = rankMembersByConsistency(
      [
        { userId: 'a', completedCount: 9, failedCount: 1, totalWorkoutMinutes: 500 },
        { userId: 'b', completedCount: 9, failedCount: 1, totalWorkoutMinutes: 100 },
        { userId: 'c', completedCount: 5, failedCount: 5, totalWorkoutMinutes: 900 },
      ],
      false
    );
    expect(rank.get('a')).toBe(1);
    expect(rank.get('b')).toBe(1);
    expect(rank.get('c')).toBe(3);
  });

  it('breaks a percent tie by total workout duration when enabled', () => {
    const rank = rankMembersByConsistency(
      [
        { userId: 'a', completedCount: 9, failedCount: 1, totalWorkoutMinutes: 500 },
        { userId: 'b', completedCount: 9, failedCount: 1, totalWorkoutMinutes: 900 },
      ],
      true
    );
    expect(rank.get('b')).toBe(1);
    expect(rank.get('a')).toBe(2);
  });

  it('shares rank 1 when percent AND duration both tie', () => {
    const rank = rankMembersByConsistency(
      [
        { userId: 'a', completedCount: 9, failedCount: 1, totalWorkoutMinutes: 500 },
        { userId: 'b', completedCount: 9, failedCount: 1, totalWorkoutMinutes: 500 },
      ],
      true
    );
    expect(rank.get('a')).toBe(1);
    expect(rank.get('b')).toBe(1);
  });

  it('ranks members with no decided days last, tied with each other', () => {
    const rank = rankMembersByConsistency(
      [
        { userId: 'a', completedCount: 1, failedCount: 0, totalWorkoutMinutes: 0 },
        { userId: 'b', completedCount: 0, failedCount: 0, totalWorkoutMinutes: 0 },
        { userId: 'c', completedCount: 0, failedCount: 0, totalWorkoutMinutes: 0 },
      ],
      false
    );
    expect(rank.get('a')).toBe(1);
    expect(rank.get('b')).toBe(2);
    expect(rank.get('c')).toBe(2);
  });
});

describe('determineTopRanked', () => {
  it('returns every userId tied for rank 1', () => {
    const rank = new Map([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ]);
    expect(determineTopRanked(rank).sort()).toEqual(['a', 'b']);
  });

  it('returns an empty array when the map is empty', () => {
    expect(determineTopRanked(new Map())).toEqual([]);
  });
});
