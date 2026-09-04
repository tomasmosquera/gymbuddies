import { BADGES } from '@/lib/domain/badges';
import {
  CHECKIN_XP,
  KOTH_CLAIM_XP,
  XP_BY_BADGE_ID,
  checkinXp,
  cumulativeXpForLevel,
  hasCompleteXpTable,
  kothClaimXp,
  levelProgress,
  totalXpForEarnedBadges,
  xpForBadge,
  xpRequiredForLevel,
} from '@/lib/domain/xp';

describe('XP table completeness', () => {
  it('assigns an XP value to every badge in the catalog', () => {
    expect(hasCompleteXpTable()).toBe(true);
  });

  it('gives the sole revocable badge (ahorrador-involuntario) 0 XP so levels can never go down', () => {
    expect(xpForBadge('ahorrador-involuntario')).toBe(0);
  });

  it('has no stray keys for badges that no longer exist', () => {
    const badgeIds = new Set(BADGES.map((b) => b.id));
    for (const key of Object.keys(XP_BY_BADGE_ID)) {
      expect(badgeIds.has(key)).toBe(true);
    }
  });
});

describe('totalXpForEarnedBadges', () => {
  it('sums XP only for the given badge ids', () => {
    expect(totalXpForEarnedBadges(['primer-paso', 'semana-fuerte'])).toBe(70);
  });

  it('returns 0 for an empty list', () => {
    expect(totalXpForEarnedBadges([])).toBe(0);
  });

  it('contributes nothing for the revocable badge even if "earned"', () => {
    expect(totalXpForEarnedBadges(['primer-paso', 'ahorrador-involuntario'])).toBe(20);
  });
});

describe('kothClaimXp', () => {
  it('grants 50 XP per valid claim, stacking without limit', () => {
    expect(kothClaimXp(0)).toBe(0);
    expect(kothClaimXp(1)).toBe(KOTH_CLAIM_XP);
    expect(kothClaimXp(5)).toBe(5 * KOTH_CLAIM_XP);
  });

  it('reclaiming a lost record earns the same 50 XP again — this is just a count, no per-exercise cap', () => {
    // 3 claims on the same exercise (win, lose it, win it back) is worth
    // exactly as much as 3 claims spread across 3 different exercises.
    expect(kothClaimXp(3)).toBe(kothClaimXp(3));
    expect(kothClaimXp(3)).toBe(150);
  });
});

describe('checkinXp', () => {
  it('grants 5 XP per valid check-in, stacking without limit', () => {
    expect(checkinXp(0)).toBe(0);
    expect(checkinXp(1)).toBe(CHECKIN_XP);
    expect(checkinXp(40)).toBe(40 * CHECKIN_XP);
  });
});

describe('xpRequiredForLevel', () => {
  it('matches the exact progression the user specified: 100, then +50 per level', () => {
    expect(xpRequiredForLevel(1)).toBe(100);
    expect(xpRequiredForLevel(2)).toBe(150);
    expect(xpRequiredForLevel(3)).toBe(200);
  });

  it('is 0 for level 0 or below', () => {
    expect(xpRequiredForLevel(0)).toBe(0);
    expect(xpRequiredForLevel(-1)).toBe(0);
  });
});

describe('cumulativeXpForLevel', () => {
  it('accumulates the incremental requirements', () => {
    expect(cumulativeXpForLevel(1)).toBe(100);
    expect(cumulativeXpForLevel(2)).toBe(250);
    expect(cumulativeXpForLevel(3)).toBe(450);
  });
});

describe('levelProgress', () => {
  it('stays at level 0 below the first threshold', () => {
    expect(levelProgress(0)).toEqual({ level: 0, totalXp: 0, currentLevelXp: 0, xpForNextLevel: 100, progress: 0 });
    expect(levelProgress(99)).toEqual({ level: 0, totalXp: 99, currentLevelXp: 99, xpForNextLevel: 100, progress: 0.99 });
  });

  it('reaches level 1 at exactly 100 XP', () => {
    expect(levelProgress(100)).toEqual({ level: 1, totalXp: 100, currentLevelXp: 0, xpForNextLevel: 150, progress: 0 });
  });

  it('tracks partial progress within level 1', () => {
    expect(levelProgress(150)).toEqual({ level: 1, totalXp: 150, currentLevelXp: 50, xpForNextLevel: 150, progress: 50 / 150 });
  });

  it('reaches level 2 at exactly 250 cumulative XP', () => {
    expect(levelProgress(250)).toEqual({ level: 2, totalXp: 250, currentLevelXp: 0, xpForNextLevel: 200, progress: 0 });
  });
});
