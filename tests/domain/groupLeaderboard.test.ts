import { rankGroupLeaderboard, type GroupLeaderboardMember } from '@/lib/domain/exerciseRecords';

const members: GroupLeaderboardMember[] = [
  { userId: 'a', fullName: 'Ana', heaviestWeightKg: 60, best1RmKg: 74, bestSetVolumeKg: 480 },
  { userId: 'b', fullName: 'Beto', heaviestWeightKg: 80, best1RmKg: 90, bestSetVolumeKg: 640 },
  { userId: 'c', fullName: 'Caro', heaviestWeightKg: 80, best1RmKg: 85, bestSetVolumeKg: 560 },
  { userId: 'd', fullName: 'Dani', heaviestWeightKg: null, best1RmKg: null, bestSetVolumeKg: null },
];

describe('rankGroupLeaderboard', () => {
  it('ranks descending by the selected metric', () => {
    const ranked = rankGroupLeaderboard(members, 'heaviestWeight');
    expect(ranked.map((m) => m.userId)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('gives tied members the same rank, and skips the next rank accordingly (1,1,3)', () => {
    const ranked = rankGroupLeaderboard(members, 'heaviestWeight');
    const byId = Object.fromEntries(ranked.map((m) => [m.userId, m.rank]));
    expect(byId.b).toBe(1);
    expect(byId.c).toBe(1);
    expect(byId.a).toBe(3);
  });

  it('always ranks a member with no data last, regardless of metric', () => {
    for (const metric of ['heaviestWeight', 'oneRepMax', 'bestSetVolume'] as const) {
      const ranked = rankGroupLeaderboard(members, metric);
      expect(ranked[ranked.length - 1].userId).toBe('d');
      expect(ranked[ranked.length - 1].rank).toBe(4);
    }
  });

  it('re-sorts differently for a different metric (1RM breaks the weight tie between b and c)', () => {
    const ranked = rankGroupLeaderboard(members, 'oneRepMax');
    expect(ranked.map((m) => m.userId)).toEqual(['b', 'c', 'a', 'd']);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });
});
