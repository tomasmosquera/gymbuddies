import { classifyMemberDay, tallyAttendance } from '@/lib/domain/attendance';

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
