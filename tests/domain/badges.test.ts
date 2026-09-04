import {
  BADGES,
  completedStreakRuns,
  longestCompletedStreak,
  currentCompletedStreak,
  weekendWarriorRun,
  currentWeekendWarriorRun,
  monthlyConsistency,
  longestConsecutiveMonthRun,
  currentConsecutiveMonthRun,
  monthlyPenalties,
  isFixedHoliday,
  totalWorkoutMinutes,
  longestSingleWorkoutMinutes,
  bestSustainedAverageWorkout,
  kothDistinctExercisesEverChampioned,
  kothHasCurrentWeightAndReps,
  type BadgeCheckinFact,
  type BadgeContext,
  type BadgeDayRecord,
} from '@/lib/domain/badges';
import { kothSimultaneousHoldTimeline, type KothClaimFact } from '@/lib/domain/koth';

let nextKothClaimId = 1;
function kothClaim(overrides: Partial<KothClaimFact> & Pick<KothClaimFact, 'exerciseId'>): KothClaimFact {
  return {
    id: `koth-claim-${nextKothClaimId++}`,
    userId: 'a',
    metricType: 'weight_kg',
    status: 'valid',
    createdAt: '2026-01-01T00:00:00Z',
    decidedAt: null,
    wasChallenged: false,
    ...overrides,
  };
}

function checkinsWithDurations(durations: (number | null)[]): BadgeCheckinFact[] {
  return durations.map((minutes, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    hourBogota: 7,
    workoutMinutes: minutes,
  }));
}

function days(spec: [string, BadgeDayRecord['status']][]): BadgeDayRecord[] {
  return spec.map(([date, status]) => ({ date, status }));
}

function baseContext(overrides: Partial<BadgeContext> = {}): BadgeContext {
  return {
    todayString: '2026-07-24',
    groupCreatedDate: '2026-01-01',
    joinedDate: '2026-01-01',
    timezone: 'America/Bogota',
    days: [],
    checkins: [],
    weeklyPenalties: [],
    hasFundedWallet: false,
    fundedWalletDate: null,
    reactionsGivenDates: [],
    reactionsGivenByRecipient: {},
    reactionsGivenToRecipientDates: {},
    reactionsReceivedCount: 0,
    reactionsReceivedDates: [],
    ruleProposalsWonCount: 0,
    firstRuleProposalWinDate: null,
    kothClaims: [],
    kothCurrentlyHeldExerciseIds: [],
    kothIsGroupFounder: false,
    kothReclaimedThroneCount: 0,
    kothFirstReclaimDate: null,
    kothSimultaneousHoldTimeline: [],
    buddyCheckinDates: [],
    ...overrides,
  };
}

function badge(id: string) {
  const found = BADGES.find((b) => b.id === id);
  if (!found) throw new Error(`missing badge ${id}`);
  return found;
}

describe('badge catalog', () => {
  it('has exactly 59 badges with unique ids', () => {
    expect(BADGES.length).toBe(59);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(59);
  });
});

describe('completedStreakRuns / longestCompletedStreak', () => {
  it('excused days pause a streak without resetting it', () => {
    const d = days([
      ['2026-01-01', 'completed'],
      ['2026-01-02', 'completed'],
      ['2026-01-03', 'excused'],
      ['2026-01-04', 'completed'],
    ]);
    expect(longestCompletedStreak(d)).toBe(3);
    expect(completedStreakRuns(d)).toEqual([3]);
  });

  it('a failed day resets the streak and starts a new run', () => {
    const d = days([
      ['2026-01-01', 'completed'],
      ['2026-01-02', 'completed'],
      ['2026-01-03', 'failed'],
      ['2026-01-04', 'completed'],
    ]);
    expect(completedStreakRuns(d)).toEqual([2, 1]);
    expect(longestCompletedStreak(d)).toBe(2);
  });
});

describe('currentCompletedStreak', () => {
  it('only counts the trailing run', () => {
    const d = days([
      ['2026-01-01', 'completed'],
      ['2026-01-02', 'completed'],
      ['2026-01-03', 'failed'],
      ['2026-01-04', 'completed'],
    ]);
    expect(currentCompletedStreak(d)).toBe(1);
  });
});

describe('weekendWarriorRun', () => {
  it('counts consecutive weeks with both Saturday and Sunday completed', () => {
    // 2026-01-03 is a Saturday, 2026-01-04 a Sunday.
    const d = days([
      ['2026-01-03', 'completed'],
      ['2026-01-04', 'completed'],
      ['2026-01-10', 'completed'],
      ['2026-01-11', 'completed'],
      ['2026-01-17', 'completed'],
      ['2026-01-18', 'failed'],
    ]);
    expect(weekendWarriorRun(d)).toBe(2);
  });
});

describe('currentWeekendWarriorRun', () => {
  it('only counts the trailing run, unlike weekendWarriorRun which keeps the best-ever one', () => {
    const d = days([
      ['2026-01-03', 'completed'],
      ['2026-01-04', 'completed'],
      ['2026-01-10', 'completed'],
      ['2026-01-11', 'completed'],
      ['2026-01-17', 'completed'],
      ['2026-01-18', 'failed'],
      ['2026-01-24', 'completed'],
      ['2026-01-25', 'completed'],
    ]);
    expect(weekendWarriorRun(d)).toBe(2);
    expect(currentWeekendWarriorRun(d)).toBe(1);
  });
});

describe('monthlyConsistency', () => {
  it('groups decided days by month, excluding excused', () => {
    const d = days([
      ['2026-01-01', 'completed'],
      ['2026-01-02', 'failed'],
      ['2026-01-03', 'excused'],
      ['2026-02-01', 'completed'],
    ]);
    const result = monthlyConsistency(d);
    expect(result).toEqual([
      { month: '2026-01', completed: 1, failed: 1, percent: 50 },
      { month: '2026-02', completed: 1, failed: 0, percent: 100 },
    ]);
  });
});

describe('longestConsecutiveMonthRun', () => {
  it('breaks on a gap month', () => {
    expect(longestConsecutiveMonthRun(['2026-01', '2026-02', '2026-04'])).toBe(2);
  });
});

describe('currentConsecutiveMonthRun', () => {
  it('walks backward from the most recent month and stops at the first non-qualifying one', () => {
    const monthQualifies = new Map([
      ['2026-01', true],
      ['2026-02', true],
      ['2026-03', false],
      ['2026-04', true],
      ['2026-05', true],
      ['2026-06', true],
    ]);
    expect(currentConsecutiveMonthRun(monthQualifies)).toBe(3);
  });

  it('returns 0 once the most recent closed month breaks the run, even if an older run was longer', () => {
    const monthQualifies = new Map([
      ['2026-01', true],
      ['2026-02', true],
      ['2026-03', true],
      ['2026-04', false],
    ]);
    expect(currentConsecutiveMonthRun(monthQualifies)).toBe(0);
  });

  it('treats a month absent from the map the same as one present but not qualifying', () => {
    const monthQualifies = new Map([
      ['2026-01', true],
      ['2026-03', true],
    ]);
    expect(currentConsecutiveMonthRun(monthQualifies)).toBe(1);
  });
});

describe('monthlyPenalties', () => {
  it('sums penalty_charged per month', () => {
    const result = monthlyPenalties([
      { weekStartDate: '2026-01-05', penaltyCharged: 10000 },
      { weekStartDate: '2026-01-12', penaltyCharged: 0 },
      { weekStartDate: '2026-02-02', penaltyCharged: 0 },
    ]);
    expect(result).toEqual([
      { month: '2026-01', penaltyCharged: 10000, weekCount: 2 },
      { month: '2026-02', penaltyCharged: 0, weekCount: 1 },
    ]);
  });
});

describe('isFixedHoliday', () => {
  it('recognizes fixed-date Colombia holidays regardless of year', () => {
    expect(isFixedHoliday('2026-12-25', 'America/Bogota')).toBe(true);
    expect(isFixedHoliday('2030-07-20', 'America/Bogota')).toBe(true);
  });

  it('rejects a non-holiday date', () => {
    expect(isFixedHoliday('2026-03-15', 'America/Bogota')).toBe(false);
  });

  it('uses a different holiday list for a Mexico City group', () => {
    expect(isFixedHoliday('2026-09-16', 'America/Mexico_City')).toBe(true); // Independencia
    expect(isFixedHoliday('2026-07-20', 'America/Mexico_City')).toBe(false); // Colombia-only, not Mexico's
  });

  it('uses a different holiday list for a Shanghai group', () => {
    expect(isFixedHoliday('2026-10-01', 'Asia/Shanghai')).toBe(true); // National Day
    expect(isFixedHoliday('2026-07-20', 'Asia/Shanghai')).toBe(false);
  });

  it('falls back to Colombia for an unrecognized timezone', () => {
    expect(isFixedHoliday('2026-07-20', 'Pacific/Fakezone')).toBe(true);
  });
});

describe('representative badge evaluations', () => {
  it('Primer Paso earns on the first checkin', () => {
    const ctx = baseContext({ checkins: [{ date: '2026-01-01', hourBogota: 7, workoutMinutes: null }] });
    expect(badge('primer-paso').evaluate(ctx)).toEqual({ earned: true, current: 1, target: 1, earnedDate: '2026-01-01' });
  });

  it('Mes Perfecto requires a 30-day streak', () => {
    const shortStreak = baseContext({
      days: Array.from({ length: 29 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        status: 'completed' as const,
      })),
    });
    expect(badge('mes-perfecto').evaluate(shortStreak).earned).toBe(false);

    const fullStreak = baseContext({
      days: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        status: 'completed' as const,
      })),
    });
    expect(badge('mes-perfecto').evaluate(fullStreak).earned).toBe(true);
  });

  it('Mes Perfecto stays earned once the 30-day streak has ever been reached, but its progress shows the current trailing streak, not the historical best', () => {
    const d = [
      ...Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, status: 'completed' as const })),
      { date: '2026-02-01', status: 'failed' as const },
      { date: '2026-02-02', status: 'completed' as const },
      { date: '2026-02-03', status: 'completed' as const },
    ];
    const status = badge('mes-perfecto').evaluate(baseContext({ todayString: '2026-02-03', days: d }));
    expect(status.earned).toBe(true);
    expect(status.current).toBe(2);
  });

  it('El Fundador only earns when joinedDate matches the group creation date', () => {
    expect(badge('el-fundador').evaluate(baseContext({ joinedDate: '2026-01-01', groupCreatedDate: '2026-01-01' })).earned).toBe(true);
    expect(badge('el-fundador').evaluate(baseContext({ joinedDate: '2026-03-01', groupCreatedDate: '2026-01-01' })).earned).toBe(false);
  });

  it('Impecable ignores the still-open current month', () => {
    // Only 3 days into July, all completed — would be a false 100% if not excluded.
    const ctx = baseContext({
      todayString: '2026-07-03',
      days: days([
        ['2026-07-01', 'completed'],
        ['2026-07-02', 'completed'],
        ['2026-07-03', 'completed'],
      ]),
    });
    expect(badge('impecable').evaluate(ctx).earned).toBe(false);
  });

  it('Constante de Verdad stays earned once 6 straight qualifying months was ever reached, but its progress reflects the run trailing up to the most recent closed month', () => {
    function monthOfDays(month: string, dayCount: number, status: BadgeDayRecord['status']): BadgeDayRecord[] {
      return Array.from({ length: dayCount }, (_, i) => ({
        date: `${month}-${String(i + 1).padStart(2, '0')}`,
        status,
      }));
    }
    const qualifyingMonths = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].flatMap((m) =>
      monthOfDays(m, 28, 'completed')
    );
    const brokenJuly = monthOfDays('2026-07', 28, 'failed');
    const status = badge('constante-de-verdad').evaluate(
      baseContext({ todayString: '2026-08-01', days: [...qualifyingMonths, ...brokenJuly] })
    );
    expect(status.earned).toBe(true);
    expect(status.current).toBe(0);
  });

  it('Piel en el Juego earns from either an initial deposit or a recharge', () => {
    expect(badge('piel-en-el-juego').evaluate(baseContext({ hasFundedWallet: false })).earned).toBe(false);
    expect(badge('piel-en-el-juego').evaluate(baseContext({ hasFundedWallet: true })).earned).toBe(true);
  });

  it('Sin Excusas checks the holiday list for the context\'s own timezone', () => {
    const mexicoIndependence = days([['2026-09-16', 'completed']]);
    expect(badge('sin-excusas').evaluate(baseContext({ days: mexicoIndependence, timezone: 'America/Bogota' })).earned).toBe(
      false
    );
    expect(badge('sin-excusas').evaluate(baseContext({ days: mexicoIndependence, timezone: 'America/Mexico_City' })).earned).toBe(
      true
    );
  });

  it('Ahorrador Involuntario requires at least one evaluated week with zero penalties', () => {
    expect(badge('ahorrador-involuntario').evaluate(baseContext({ weeklyPenalties: [] })).earned).toBe(false);
    expect(
      badge('ahorrador-involuntario').evaluate(
        baseContext({ weeklyPenalties: [{ weekStartDate: '2026-01-05', penaltyCharged: 0 }] })
      ).earned
    ).toBe(true);
    expect(
      badge('ahorrador-involuntario').evaluate(
        baseContext({
          weeklyPenalties: [
            { weekStartDate: '2026-01-05', penaltyCharged: 0 },
            { weekStartDate: '2026-01-12', penaltyCharged: 5000 },
          ],
        })
      ).earned
    ).toBe(false);
  });

  it('Ahorrador Involuntario never carries an earnedDate — the sole revocable badge, so "when earned" is not a stable fact', () => {
    const ctx = baseContext({ weeklyPenalties: [{ weekStartDate: '2026-01-05', penaltyCharged: 0 }] });
    const status = badge('ahorrador-involuntario').evaluate(ctx);
    expect(status.earned).toBe(true);
    expect(status.earnedDate).toBeNull();
  });

  it('Fan Número Uno needs 20 reactions given to the same recipient', () => {
    expect(badge('fan-numero-uno').evaluate(baseContext({ reactionsGivenByRecipient: { alice: 19, bob: 5 } })).earned).toBe(false);
    expect(badge('fan-numero-uno').evaluate(baseContext({ reactionsGivenByRecipient: { alice: 20, bob: 5 } })).earned).toBe(true);
  });

  it('Alma del Grupo needs 30 consecutive calendar days of reactions given', () => {
    const consecutive = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    expect(
      badge('alma-del-grupo').evaluate(baseContext({ todayString: '2026-01-30', reactionsGivenDates: consecutive })).earned
    ).toBe(true);
    expect(
      badge('alma-del-grupo').evaluate(baseContext({ todayString: '2026-01-29', reactionsGivenDates: consecutive.slice(0, 29) }))
        .earned
    ).toBe(false);
  });

  it('Alma del Grupo stays earned once 30 in a row was ever reached, but its progress reflects the streak trailing up to today, not the historical best', () => {
    const consecutive = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    // Gave reactions 30 days straight through Jan 30, then stopped for a
    // while, then gave one more today (Feb 3) — the historic best (30) must
    // still count as earned, but "current" should reflect only today's
    // fresh 1-day run, not the old 30-day one.
    const status = badge('alma-del-grupo').evaluate(
      baseContext({ todayString: '2026-02-03', reactionsGivenDates: [...consecutive, '2026-02-03'] })
    );
    expect(status.earned).toBe(true);
    expect(status.current).toBe(1);
  });

  it('Maratonista requires 1,000 accumulated workout minutes', () => {
    expect(badge('maratonista').evaluate(baseContext({ checkins: checkinsWithDurations([500, 400]) })).earned).toBe(false);
    expect(badge('maratonista').evaluate(baseContext({ checkins: checkinsWithDurations([500, 500]) })).earned).toBe(true);
  });

  it('Ultra Maratonista requires 10,000 accumulated workout minutes', () => {
    expect(badge('ultra-maratonista').evaluate(baseContext({ checkins: checkinsWithDurations([5000, 4999]) })).earned).toBe(false);
    expect(badge('ultra-maratonista').evaluate(baseContext({ checkins: checkinsWithDurations([5000, 5000]) })).earned).toBe(true);
  });

  it('Entreno de Hierro requires a single 120+ minute workout', () => {
    expect(badge('entreno-de-hierro').evaluate(baseContext({ checkins: checkinsWithDurations([60, 119]) })).earned).toBe(false);
    expect(badge('entreno-de-hierro').evaluate(baseContext({ checkins: checkinsWithDurations([60, 120]) })).earned).toBe(true);
  });

  it('Máquina de Resistencia requires a single 180+ minute workout', () => {
    expect(badge('maquina-de-resistencia').evaluate(baseContext({ checkins: checkinsWithDurations([179]) })).earned).toBe(false);
    expect(badge('maquina-de-resistencia').evaluate(baseContext({ checkins: checkinsWithDurations([180]) })).earned).toBe(true);
  });

  it('Constancia de Acero requires a sustained 45+ min average over 50+ checkins with duration', () => {
    const under50 = checkinsWithDurations(Array.from({ length: 49 }, () => 50));
    expect(badge('constancia-de-acero').evaluate(baseContext({ checkins: under50 })).earned).toBe(false);

    const fiftyLowAverage = checkinsWithDurations(Array.from({ length: 50 }, () => 40));
    expect(badge('constancia-de-acero').evaluate(baseContext({ checkins: fiftyLowAverage })).earned).toBe(false);

    const fiftyHighAverage = checkinsWithDurations(Array.from({ length: 50 }, () => 45));
    expect(badge('constancia-de-acero').evaluate(baseContext({ checkins: fiftyHighAverage })).earned).toBe(true);
  });
});

describe('totalWorkoutMinutes / longestSingleWorkoutMinutes', () => {
  it('sums durations, treating null as 0', () => {
    expect(totalWorkoutMinutes(checkinsWithDurations([30, null, 45]))).toBe(75);
  });

  it('finds the longest single workout', () => {
    expect(longestSingleWorkoutMinutes(checkinsWithDurations([30, 90, 45]))).toBe(90);
  });
});

describe('bestSustainedAverageWorkout', () => {
  it('does not qualify with fewer checkins than the window size, but still reports a running average', () => {
    const result = bestSustainedAverageWorkout(checkinsWithDurations([50, 60]), 50);
    expect(result.qualifies).toBe(false);
    expect(result.average).toBe(55);
  });

  it('is monotonic — a strong early window keeps qualifying even after later short workouts drag down the overall average', () => {
    const strongWindow = Array.from({ length: 50 }, () => 60); // avg 60
    const laterShortWorkouts = Array.from({ length: 20 }, () => 5); // avg 5, dragging the lifetime average way down
    const result = bestSustainedAverageWorkout(checkinsWithDurations([...strongWindow, ...laterShortWorkouts]), 50);
    expect(result.qualifies).toBe(true);
    expect(result.average).toBe(60);
  });
});

describe('kothDistinctExercisesEverChampioned', () => {
  it('counts distinct exercises regardless of how many times each was claimed or their current status', () => {
    const claims = [
      kothClaim({ exerciseId: 'bench' }),
      kothClaim({ exerciseId: 'bench', status: 'invalidated' }),
      kothClaim({ exerciseId: 'squat' }),
    ];
    expect(kothDistinctExercisesEverChampioned(claims)).toBe(2);
  });
});

describe('kothHasCurrentWeightAndReps', () => {
  it('is true only when the currently held exercises include both a weight one and a reps one', () => {
    const claims = [
      kothClaim({ exerciseId: 'bench', metricType: 'weight_kg' }),
      kothClaim({ exerciseId: 'pullups', metricType: 'reps' }),
    ];
    expect(kothHasCurrentWeightAndReps(claims, ['bench', 'pullups'])).toBe(true);
    expect(kothHasCurrentWeightAndReps(claims, ['bench'])).toBe(false);
    expect(kothHasCurrentWeightAndReps(claims, ['pullups'])).toBe(false);
  });
});

describe('King of the Hill badges', () => {
  it('primer-trono earns on the first claim, ever', () => {
    expect(badge('primer-trono').evaluate(baseContext({ kothClaims: [] })).earned).toBe(false);
    expect(badge('primer-trono').evaluate(baseContext({ kothClaims: [kothClaim({ exerciseId: 'bench' })] })).earned).toBe(true);
  });

  it('fundador-del-trono reads the precomputed group-founder flag', () => {
    expect(badge('fundador-del-trono').evaluate(baseContext({ kothIsGroupFounder: false })).earned).toBe(false);
    expect(badge('fundador-del-trono').evaluate(baseContext({ kothIsGroupFounder: true })).earned).toBe(true);
  });

  it('multi-corona / rey-absoluto / dueno-del-gym key off the historical peak of simultaneously-held exercises (monotonic), not a live snapshot', () => {
    const claims = [
      kothClaim({ exerciseId: 'bench', userId: 'a', createdAt: '2026-01-01T00:00:00Z' }),
      kothClaim({ exerciseId: 'squat', userId: 'a', createdAt: '2026-01-05T00:00:00Z' }),
      kothClaim({ exerciseId: 'deadlift', userId: 'a', createdAt: '2026-01-10T00:00:00Z' }),
      // 'a' is later dethroned on all three — a live snapshot would show 0
      // held, but the badge (like every other lifetime badge) must stay earned.
      kothClaim({ exerciseId: 'bench', userId: 'b', createdAt: '2026-03-01T00:00:00Z' }),
      kothClaim({ exerciseId: 'squat', userId: 'b', createdAt: '2026-03-02T00:00:00Z' }),
      kothClaim({ exerciseId: 'deadlift', userId: 'b', createdAt: '2026-03-03T00:00:00Z' }),
    ];
    const ctx = baseContext({ kothSimultaneousHoldTimeline: kothSimultaneousHoldTimeline(claims, 'a') });
    const multiCorona = badge('multi-corona').evaluate(ctx);
    expect(multiCorona.earned).toBe(true);
    expect(multiCorona.earnedDate).toBe('2026-01-10T00:00:00Z');
    expect(badge('rey-absoluto').evaluate(ctx).earned).toBe(false);
    expect(badge('dueno-del-gym').evaluate(ctx).earned).toBe(false);

    const twelveClaims = Array.from({ length: 12 }, (_, i) =>
      kothClaim({ exerciseId: `ex-${i}`, userId: 'a', createdAt: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z` })
    );
    const twelveCtx = baseContext({ kothSimultaneousHoldTimeline: kothSimultaneousHoldTimeline(twelveClaims, 'a') });
    expect(badge('dueno-del-gym').evaluate(twelveCtx).earned).toBe(true);
  });

  it('todocampista needs all 12 exercises ever championed, not necessarily at once', () => {
    const elevenDistinct = Array.from({ length: 11 }, (_, i) => kothClaim({ exerciseId: `ex-${i}` }));
    expect(badge('todocampista').evaluate(baseContext({ kothClaims: elevenDistinct })).earned).toBe(false);
    const twelveDistinct = Array.from({ length: 12 }, (_, i) => kothClaim({ exerciseId: `ex-${i}` }));
    expect(badge('todocampista').evaluate(baseContext({ kothClaims: twelveDistinct })).earned).toBe(true);
  });

  it('doble-amenaza needs a weight exercise and a reps exercise held at once, at some point in history (not necessarily right now)', () => {
    const bothTypes = [
      kothClaim({ exerciseId: 'bench', userId: 'a', metricType: 'weight_kg', createdAt: '2026-01-01T00:00:00Z' }),
      kothClaim({ exerciseId: 'pullups', userId: 'a', metricType: 'reps', createdAt: '2026-01-05T00:00:00Z' }),
    ];
    const status = badge('doble-amenaza').evaluate(
      baseContext({ kothSimultaneousHoldTimeline: kothSimultaneousHoldTimeline(bothTypes, 'a') })
    );
    expect(status.earned).toBe(true);
    expect(status.earnedDate).toBe('2026-01-05T00:00:00Z');

    const onlyWeight = [kothClaim({ exerciseId: 'bench', userId: 'a', metricType: 'weight_kg', createdAt: '2026-01-01T00:00:00Z' })];
    expect(
      badge('doble-amenaza').evaluate(baseContext({ kothSimultaneousHoldTimeline: kothSimultaneousHoldTimeline(onlyWeight, 'a') })).earned
    ).toBe(false);
  });

  it('el-resistente needs a claim that survived a real challenge (valid + wasChallenged)', () => {
    expect(
      badge('el-resistente').evaluate(baseContext({ kothClaims: [kothClaim({ exerciseId: 'bench', status: 'valid', wasChallenged: false })] })).earned
    ).toBe(false);
    expect(
      badge('el-resistente').evaluate(baseContext({ kothClaims: [kothClaim({ exerciseId: 'bench', status: 'invalidated', wasChallenged: true })] })).earned
    ).toBe(false);
    expect(
      badge('el-resistente').evaluate(baseContext({ kothClaims: [kothClaim({ exerciseId: 'bench', status: 'valid', wasChallenged: true })] })).earned
    ).toBe(true);
  });

  it('retorno-del-rey reads the precomputed reclaim count', () => {
    expect(badge('retorno-del-rey').evaluate(baseContext({ kothReclaimedThroneCount: 0 })).earned).toBe(false);
    expect(badge('retorno-del-rey').evaluate(baseContext({ kothReclaimedThroneCount: 1 })).earned).toBe(true);
  });

  it('veinte-superaciones thresholds on total claims ever made', () => {
    const nineteen = Array.from({ length: 19 }, (_, i) => kothClaim({ exerciseId: `ex-${i % 3}` }));
    expect(badge('veinte-superaciones').evaluate(baseContext({ kothClaims: nineteen })).earned).toBe(false);
    const twenty = Array.from({ length: 20 }, (_, i) => kothClaim({ exerciseId: `ex-${i % 3}` }));
    expect(badge('veinte-superaciones').evaluate(baseContext({ kothClaims: twenty })).earned).toBe(true);
  });
});
