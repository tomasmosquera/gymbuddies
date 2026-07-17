import { computeRequiredVotes, resolveOnTimeout, tallyOutcome } from '@/lib/domain/voting';

describe('computeRequiredVotes', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [7, 4],
  ])('memberCount=%i -> requiredVotes=%i', (memberCount, expected) => {
    expect(computeRequiredVotes(memberCount)).toBe(expected);
  });

  it('rejects negative or non-integer counts', () => {
    expect(() => computeRequiredVotes(-1)).toThrow();
    expect(() => computeRequiredVotes(2.5)).toThrow();
  });
});

describe('tallyOutcome', () => {
  it('approves as soon as yes votes reach the required threshold, without waiting for everyone', () => {
    // 7 members, required 4. 4 yes votes in and 3 members haven't voted yet.
    expect(tallyOutcome({ yes: 4, no: 0 }, 4, 7)).toBe('approved');
  });

  it('rejects as soon as a yes-majority becomes mathematically impossible', () => {
    // 7 members, required 4, so at most 3 no-votes can exist before a yes
    // majority is impossible even if everyone remaining votes yes.
    expect(tallyOutcome({ yes: 0, no: 4 }, 4, 7)).toBe('rejected');
  });

  it('stays pending while the outcome is still undetermined', () => {
    expect(tallyOutcome({ yes: 2, no: 2 }, 4, 7)).toBe('pending');
  });

  it('handles a unanimous small group correctly', () => {
    expect(tallyOutcome({ yes: 1, no: 0 }, 1, 1)).toBe('approved');
    expect(tallyOutcome({ yes: 0, no: 1 }, 1, 1)).toBe('rejected');
  });
});

describe('resolveOnTimeout', () => {
  it('approves if yes votes met the threshold by the deadline', () => {
    expect(resolveOnTimeout({ yes: 4, no: 3 }, 4)).toBe('approved');
  });

  it('rejects ties and any shortfall — status quo wins by default', () => {
    expect(resolveOnTimeout({ yes: 3, no: 3 }, 4)).toBe('rejected');
    expect(resolveOnTimeout({ yes: 0, no: 0 }, 4)).toBe('rejected');
  });
});
