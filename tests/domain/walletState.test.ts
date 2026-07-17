import { failsRemaining, needsRecharge } from '@/lib/domain/walletState';

describe('failsRemaining', () => {
  it('floors partial fails since a partial penalty cannot be charged', () => {
    expect(failsRemaining(45000, 10000)).toBe(4);
  });

  it('returns 0 once the balance can no longer absorb even one more fail', () => {
    expect(failsRemaining(5000, 10000)).toBe(0);
    expect(failsRemaining(0, 10000)).toBe(0);
  });

  it('never returns a negative count for an already-negative balance', () => {
    expect(failsRemaining(-5000, 10000)).toBe(0);
  });

  it('returns null when the group charges no penalty at all', () => {
    expect(failsRemaining(50000, 0)).toBeNull();
  });
});

describe('needsRecharge', () => {
  it('is true at exactly zero and below', () => {
    expect(needsRecharge(0)).toBe(true);
    expect(needsRecharge(-1)).toBe(true);
  });

  it('is false for any positive balance', () => {
    expect(needsRecharge(1)).toBe(false);
  });
});
