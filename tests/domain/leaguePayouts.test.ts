import { computeCooperativeShare, computeLeaguePlacements } from '@/lib/domain/leaguePayouts';

function rankMap(entries: [string, number][]): Map<string, number> {
  return new Map(entries);
}

describe('computeLeaguePlacements', () => {
  it('assigns each place its own split when there are no ties', () => {
    const ranks = rankMap([
      ['alice', 1],
      ['bob', 2],
      ['carol', 3],
    ]);
    expect(computeLeaguePlacements(ranks, [60, 30, 10])).toEqual([
      { userId: 'alice', place: 1, sharePercent: 60 },
      { userId: 'bob', place: 2, sharePercent: 30 },
      { userId: 'carol', place: 3, sharePercent: 10 },
    ]);
  });

  it('merges slots across a full tie for 1st and splits evenly', () => {
    const ranks = rankMap([
      ['alice', 1],
      ['bob', 1],
      ['carol', 3],
    ]);
    expect(computeLeaguePlacements(ranks, [60, 30, 10])).toEqual([
      { userId: 'alice', place: 1, sharePercent: 45 },
      { userId: 'bob', place: 1, sharePercent: 45 },
      { userId: 'carol', place: 3, sharePercent: 10 },
    ]);
  });

  it('leaves an unfilled slot undistributed when there are fewer participants than prize places', () => {
    const ranks = rankMap([
      ['alice', 1],
      ['bob', 2],
    ]);
    expect(computeLeaguePlacements(ranks, [60, 30, 10])).toEqual([
      { userId: 'alice', place: 1, sharePercent: 60 },
      { userId: 'bob', place: 2, sharePercent: 30 },
    ]);
  });

  it('supports winner-take-all splits that do not sum to 100', () => {
    const ranks = rankMap([
      ['alice', 1],
      ['bob', 2],
    ]);
    expect(computeLeaguePlacements(ranks, [100])).toEqual([{ userId: 'alice', place: 1, sharePercent: 100 }]);
  });

  it('returns nothing for an empty rank map', () => {
    expect(computeLeaguePlacements(rankMap([]), [60, 30, 10])).toEqual([]);
  });
});

describe('computeCooperativeShare', () => {
  it('splits the pool evenly and rounds to cents', () => {
    expect(computeCooperativeShare(150, 4)).toBe(37.5);
    expect(computeCooperativeShare(100, 3)).toBeCloseTo(33.33, 2);
  });

  it('returns 0 when there are no active members', () => {
    expect(computeCooperativeShare(150, 0)).toBe(0);
  });

  it('clamps a negative pool to a 0 share', () => {
    expect(computeCooperativeShare(-50, 3)).toBe(0);
  });

  it('only considers the cooperative slice of the pool in mixed mode', () => {
    expect(computeCooperativeShare(300, 4, 40)).toBe(45); // 60% of 300 / 4
  });
});
