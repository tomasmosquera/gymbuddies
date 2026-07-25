import { BADGES } from '@/lib/domain/badges';
import {
  XP_BY_BADGE_ID,
  cumulativeXpForLevel,
  hasCompleteXpTable,
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
