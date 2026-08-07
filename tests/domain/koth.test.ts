import {
  beatsCurrentRecord,
  formatKothValue,
  isKothGroupFounder,
  kgToLbs,
  kothActiveExerciseIdsInMonth,
  kothClaimedExerciseIdsInMonth,
  kothDefendedInMonth,
  kothReclaimedThroneCount,
  lbsToKg,
  toCanonicalValue,
  type KothClaimFact,
} from '@/lib/domain/koth';

let nextId = 1;
function claim(overrides: Partial<KothClaimFact> & Pick<KothClaimFact, 'exerciseId' | 'userId' | 'createdAt'>): KothClaimFact {
  return {
    id: `claim-${nextId++}`,
    metricType: 'weight_kg',
    status: 'valid',
    decidedAt: null,
    wasChallenged: false,
    ...overrides,
  };
}

describe('lbsToKg / kgToLbs', () => {
  it('round-trips within floating point tolerance', () => {
    expect(lbsToKg(220)).toBeCloseTo(99.79, 1);
    expect(kgToLbs(100)).toBeCloseTo(220.46, 1);
    expect(kgToLbs(lbsToKg(185))).toBeCloseTo(185, 5);
  });
});

describe('toCanonicalValue', () => {
  it('passes reps through unchanged, ignoring any unit', () => {
    expect(toCanonicalValue('reps', 12, null)).toBe(12);
  });

  it('keeps kg as-is', () => {
    expect(toCanonicalValue('weight_kg', 100, 'kg')).toBe(100);
  });

  it('converts lbs to kg', () => {
    expect(toCanonicalValue('weight_kg', 220, 'lbs')).toBeCloseTo(99.79, 1);
  });
});

describe('formatKothValue', () => {
  it('formats reps as a singular/plural rep count', () => {
    expect(formatKothValue('reps', 1)).toBe('1 rep');
    expect(formatKothValue('reps', 12)).toBe('12 reps');
  });

  it('formats weight in both kg and lbs', () => {
    expect(formatKothValue('weight_kg', 100)).toBe('100 kg (220.5 lbs)');
  });
});

describe('beatsCurrentRecord', () => {
  it('accepts any positive value when there is no current record', () => {
    expect(beatsCurrentRecord('weight_kg', 50, 'kg', null)).toBe(true);
  });

  it('requires strictly greater — a tie does not dethrone', () => {
    expect(beatsCurrentRecord('weight_kg', 100, 'kg', 100)).toBe(false);
  });

  it('rejects a weaker claim', () => {
    expect(beatsCurrentRecord('weight_kg', 90, 'kg', 100)).toBe(false);
  });

  it('accepts a stronger claim submitted in a different unit than the record is stored in', () => {
    // 250 lbs ≈ 113.4kg > 100kg record
    expect(beatsCurrentRecord('weight_kg', 250, 'lbs', 100)).toBe(true);
  });

  it('compares reps directly with no conversion', () => {
    expect(beatsCurrentRecord('reps', 15, null, 12)).toBe(true);
    expect(beatsCurrentRecord('reps', 10, null, 12)).toBe(false);
  });
});

describe('isKothGroupFounder', () => {
  it('is false when the group has no claims at all', () => {
    expect(isKothGroupFounder([], 'a')).toBe(false);
  });

  it('is true only for whoever made the group\'s chronologically earliest claim', () => {
    const claims = [
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-05T00:00:00Z' }),
      claim({ exerciseId: 'squat', userId: 'b', createdAt: '2026-01-01T00:00:00Z' }),
      claim({ exerciseId: 'bench', userId: 'c', createdAt: '2026-01-10T00:00:00Z' }),
    ];
    expect(isKothGroupFounder(claims, 'b')).toBe(true);
    expect(isKothGroupFounder(claims, 'a')).toBe(false);
    expect(isKothGroupFounder(claims, 'c')).toBe(false);
  });
});

describe('kothReclaimedThroneCount', () => {
  it('is 0 for a member who has never lost and regained a throne', () => {
    const claims = [claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-01T00:00:00Z' })];
    expect(kothReclaimedThroneCount(claims, 'a')).toBe(0);
  });

  it('is 0 when someone else claims first — that is not a reclaim, just their first time', () => {
    const claims = [
      claim({ exerciseId: 'bench', userId: 'b', createdAt: '2026-01-01T00:00:00Z' }),
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-05T00:00:00Z' }),
    ];
    expect(kothReclaimedThroneCount(claims, 'a')).toBe(0);
  });

  it('counts a genuine lose-then-regain on the same exercise', () => {
    const claims = [
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-01T00:00:00Z' }),
      claim({ exerciseId: 'bench', userId: 'b', createdAt: '2026-01-05T00:00:00Z' }),
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-10T00:00:00Z' }),
    ];
    expect(kothReclaimedThroneCount(claims, 'a')).toBe(1);
  });

  it('does not count consecutive claims by the same member as a reclaim (never lost it to anyone)', () => {
    const claims = [
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-01T00:00:00Z', status: 'invalidated' }),
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-05T00:00:00Z' }),
    ];
    expect(kothReclaimedThroneCount(claims, 'a')).toBe(0);
  });

  it('sums reclaims across multiple exercises independently', () => {
    const claims = [
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-01T00:00:00Z' }),
      claim({ exerciseId: 'bench', userId: 'b', createdAt: '2026-01-05T00:00:00Z' }),
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-10T00:00:00Z' }),
      claim({ exerciseId: 'squat', userId: 'a', createdAt: '2026-01-01T00:00:00Z' }),
      claim({ exerciseId: 'squat', userId: 'c', createdAt: '2026-01-05T00:00:00Z' }),
      claim({ exerciseId: 'squat', userId: 'a', createdAt: '2026-01-10T00:00:00Z' }),
    ];
    expect(kothReclaimedThroneCount(claims, 'a')).toBe(2);
  });
});

describe('kothClaimedExerciseIdsInMonth', () => {
  it('returns distinct exercise ids claimed by this member within the given month', () => {
    const claims = [
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-02-03T00:00:00Z' }),
      claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-02-20T00:00:00Z' }),
      claim({ exerciseId: 'squat', userId: 'a', createdAt: '2026-02-10T00:00:00Z' }),
      claim({ exerciseId: 'deadlift', userId: 'a', createdAt: '2026-03-01T00:00:00Z' }),
      claim({ exerciseId: 'pullups', userId: 'b', createdAt: '2026-02-15T00:00:00Z' }),
    ];
    expect(new Set(kothClaimedExerciseIdsInMonth(claims, 'a', '2026-02'))).toEqual(new Set(['bench', 'squat']));
  });
});

describe('kothDefendedInMonth', () => {
  it('is true only for a claim that was challenged, survived, and was decided in that month', () => {
    const claims = [
      claim({
        exerciseId: 'bench',
        userId: 'a',
        createdAt: '2026-02-01T00:00:00Z',
        status: 'valid',
        wasChallenged: true,
        decidedAt: '2026-02-05T00:00:00Z',
      }),
    ];
    expect(kothDefendedInMonth(claims, 'a', '2026-02')).toBe(true);
    expect(kothDefendedInMonth(claims, 'a', '2026-03')).toBe(false);
  });

  it('is false if nobody challenged it — surviving unopposed is not a defense', () => {
    const claims = [
      claim({
        exerciseId: 'bench',
        userId: 'a',
        createdAt: '2026-02-01T00:00:00Z',
        status: 'valid',
        wasChallenged: false,
        decidedAt: '2026-02-05T00:00:00Z',
      }),
    ];
    expect(kothDefendedInMonth(claims, 'a', '2026-02')).toBe(false);
  });

  it('is false if the challenge succeeded (claim was invalidated)', () => {
    const claims = [
      claim({
        exerciseId: 'bench',
        userId: 'a',
        createdAt: '2026-02-01T00:00:00Z',
        status: 'invalidated',
        wasChallenged: true,
        decidedAt: '2026-02-05T00:00:00Z',
      }),
    ];
    expect(kothDefendedInMonth(claims, 'a', '2026-02')).toBe(false);
  });
});

describe('kothActiveExerciseIdsInMonth', () => {
  it('includes exercises claimed fresh this month even without a decision', () => {
    const claims = [claim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-02-01T00:00:00Z', status: 'pending_vote' })];
    expect(kothActiveExerciseIdsInMonth(claims, 'a', '2026-02')).toEqual(['bench']);
  });

  it('includes exercises successfully defended this month even if claimed a prior month', () => {
    const claims = [
      claim({
        exerciseId: 'bench',
        userId: 'a',
        createdAt: '2026-01-01T00:00:00Z',
        status: 'valid',
        wasChallenged: true,
        decidedAt: '2026-02-05T00:00:00Z',
      }),
    ];
    // Active in January too — that's when it was actually claimed.
    expect(kothActiveExerciseIdsInMonth(claims, 'a', '2026-01')).toEqual(['bench']);
    // Still active in February, on the strength of the successful defense alone.
    expect(kothActiveExerciseIdsInMonth(claims, 'a', '2026-02')).toEqual(['bench']);
    // Not active at all in a month with neither the claim nor a decision.
    expect(kothActiveExerciseIdsInMonth(claims, 'a', '2026-03')).toEqual([]);
  });

  it('excludes a record held passively with no activity this month — the "Rey del Mes" farming guard', () => {
    const claims = [claim({ exerciseId: 'bench', userId: 'a', createdAt: '2025-06-01T00:00:00Z', status: 'valid', wasChallenged: false })];
    expect(kothActiveExerciseIdsInMonth(claims, 'a', '2026-02')).toEqual([]);
  });
});
