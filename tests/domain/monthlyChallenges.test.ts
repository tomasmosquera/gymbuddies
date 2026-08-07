import {
  MONTHLY_CHALLENGES,
  allWeekendsCompleted,
  completedOnAnyHoliday,
  computeWeeklyMvpsByWeek,
  determineTopByCount,
  determineWeekMvps,
  monthHasFixedHoliday,
  tallyMonth,
  tallyMvpWeeksByMonth,
  type MonthlyDayRecord,
  type MonthlyMemberContext,
} from '@/lib/domain/monthlyChallenges';

function days(spec: [string, MonthlyDayRecord['status']][]): MonthlyDayRecord[] {
  return spec.map(([date, status]) => ({ date, status }));
}

describe('monthly challenge catalog', () => {
  it('has exactly 28 challenges with unique ids', () => {
    expect(MONTHLY_CHALLENGES.length).toBe(28);
    expect(new Set(MONTHLY_CHALLENGES.map((c) => c.id)).size).toBe(28);
  });
});

describe('monthHasFixedHoliday', () => {
  it('is true for a month containing a fixed holiday', () => {
    expect(monthHasFixedHoliday('2026-12', 'America/Bogota')).toBe(true); // Dec 25
    expect(monthHasFixedHoliday('2026-07', 'America/Bogota')).toBe(true); // Jul 20
  });

  it('is false for a month with no fixed holiday', () => {
    expect(monthHasFixedHoliday('2026-02', 'America/Bogota')).toBe(false);
  });

  it('uses the holiday list matching the given timezone, not always Colombia', () => {
    expect(monthHasFixedHoliday('2026-07', 'America/Mexico_City')).toBe(false); // Jul 20 is Colombia-only
    expect(monthHasFixedHoliday('2026-09', 'America/Mexico_City')).toBe(true); // Sep 16, Mexico's independence
  });

  it('handles a leap-year February without error (datesInMonth must enumerate all 29 days)', () => {
    expect(monthHasFixedHoliday('2028-02', 'America/Bogota')).toBe(false);
  });
});

describe('completedOnAnyHoliday', () => {
  it('is true only if a holiday date is completed', () => {
    expect(completedOnAnyHoliday(days([['2026-12-25', 'completed']]), 'America/Bogota')).toBe(true);
    expect(completedOnAnyHoliday(days([['2026-12-25', 'failed']]), 'America/Bogota')).toBe(false);
    expect(completedOnAnyHoliday(days([['2026-12-24', 'completed']]), 'America/Bogota')).toBe(false);
  });
});

describe('allWeekendsCompleted', () => {
  it('returns null when the member has no tracked weekend that month', () => {
    // 2026-02-01 is a Sunday with no matching Saturday in the given days.
    expect(allWeekendsCompleted(days([['2026-02-01', 'completed']]))).toBeNull();
  });

  it('returns true only when every Saturday+Sunday pair is completed', () => {
    // 2026-02-07/08 and 2026-02-14/15 are both Sat/Sun pairs.
    const complete = days([
      ['2026-02-07', 'completed'],
      ['2026-02-08', 'completed'],
      ['2026-02-14', 'completed'],
      ['2026-02-15', 'completed'],
    ]);
    expect(allWeekendsCompleted(complete)).toBe(true);

    const incomplete = days([
      ['2026-02-07', 'completed'],
      ['2026-02-08', 'completed'],
      ['2026-02-14', 'completed'],
      ['2026-02-15', 'failed'],
    ]);
    expect(allWeekendsCompleted(incomplete)).toBe(false);
  });
});

describe('tallyMonth', () => {
  it('counts completed/failed and computes percent, ignoring excused', () => {
    expect(
      tallyMonth(
        days([
          ['2026-02-01', 'completed'],
          ['2026-02-02', 'failed'],
          ['2026-02-03', 'excused'],
        ])
      )
    ).toEqual({ completed: 1, failed: 1, percent: 50 });
  });

  it('returns 0 percent with no decided days', () => {
    expect(tallyMonth([])).toEqual({ completed: 0, failed: 0, percent: 0 });
  });
});

describe('determineWeekMvps', () => {
  it('picks the highest consistency percent, no ties', () => {
    expect(
      determineWeekMvps(
        [
          { userId: 'a', completedCount: 5, failedCount: 0, totalWorkoutMinutes: 0 },
          { userId: 'b', completedCount: 3, failedCount: 1, totalWorkoutMinutes: 0 },
        ],
        false
      )
    ).toEqual(['a']);
  });

  it('shares the MVP on a percent tie when duration tiebreak is off (group has no checkout photos)', () => {
    expect(
      determineWeekMvps(
        [
          { userId: 'a', completedCount: 4, failedCount: 0, totalWorkoutMinutes: 10 },
          { userId: 'b', completedCount: 5, failedCount: 0, totalWorkoutMinutes: 999 },
        ],
        false
      )
    ).toEqual(['a', 'b']);
  });

  it('breaks a percent tie by total workout duration when the group requires checkout photos', () => {
    expect(
      determineWeekMvps(
        [
          { userId: 'a', completedCount: 4, failedCount: 0, totalWorkoutMinutes: 40 },
          { userId: 'b', completedCount: 4, failedCount: 0, totalWorkoutMinutes: 90 },
        ],
        true
      )
    ).toEqual(['b']);
  });

  it('shares the MVP when still tied after the duration tiebreak', () => {
    expect(
      determineWeekMvps(
        [
          { userId: 'a', completedCount: 5, failedCount: 0, totalWorkoutMinutes: 60 },
          { userId: 'b', completedCount: 5, failedCount: 0, totalWorkoutMinutes: 60 },
        ],
        true
      )
    ).toEqual(['a', 'b']);
  });
});

describe('determineTopByCount', () => {
  it('picks the max, sharing ties', () => {
    expect(
      determineTopByCount([
        { userId: 'a', count: 10 },
        { userId: 'b', count: 10 },
        { userId: 'c', count: 3 },
      ])
    ).toEqual(['a', 'b']);
  });

  it('returns nobody when everyone has 0', () => {
    expect(
      determineTopByCount([
        { userId: 'a', count: 0 },
        { userId: 'b', count: 0 },
      ])
    ).toEqual([]);
  });
});

describe('computeWeeklyMvpsByWeek / tallyMvpWeeksByMonth', () => {
  it('tallies how many weeks per month each user was MVP', () => {
    const mvpsByWeek = computeWeeklyMvpsByWeek(
      [
        // Week 1: a has a clean 100%, b has a failed day (75%) — a wins.
        { userId: 'a', weekStartDate: '2026-02-02', completedCount: 5, failedCount: 0, totalWorkoutMinutes: 0 },
        { userId: 'b', weekStartDate: '2026-02-02', completedCount: 3, failedCount: 1, totalWorkoutMinutes: 0 },
        // Week 2: both 100% (no duration tiebreak) — shared.
        { userId: 'a', weekStartDate: '2026-02-09', completedCount: 4, failedCount: 0, totalWorkoutMinutes: 0 },
        { userId: 'b', weekStartDate: '2026-02-09', completedCount: 4, failedCount: 0, totalWorkoutMinutes: 0 },
      ],
      false
    );
    const tally = tallyMvpWeeksByMonth(mvpsByWeek);
    expect(tally.get('2026-02')?.get('a')).toBe(2);
    expect(tally.get('2026-02')?.get('b')).toBe(1);
  });
});

function baseContext(overrides: Partial<MonthlyMemberContext> = {}): MonthlyMemberContext {
  return {
    completedCount: 0,
    failedCount: 0,
    consistencyPercent: 0,
    closedWeeksInMonth: [],
    monthHasFixedHoliday: false,
    completedOnHoliday: false,
    allWeekendsCompleted: null,
    anyWeekendCompleted: null,
    reactionsGivenCount: 0,
    rank: null,
    rankedGroupSize: 0,
    previousMonthRank: null,
    isMostReactedThisMonth: false,
    mvpWeeksThisMonth: 0,
    groupRequiresCheckoutPhoto: false,
    totalWorkoutMinutesInMonth: 0,
    averageWorkoutMinutesInMonth: 0,
    workoutSessionsWithDurationInMonth: 0,
    isMostDurationThisMonth: false,
    kothClaimedExerciseIdsThisMonth: [],
    kothDefendedThisMonth: false,
    isKothKingThisMonth: false,
    ...overrides,
  };
}

function challenge(id: string) {
  const found = MONTHLY_CHALLENGES.find((c) => c.id === id);
  if (!found) throw new Error(`missing monthly challenge ${id}`);
  return found;
}

describe('representative monthly challenge evaluations', () => {
  it('Mes Perfecto is not applicable with no closed weeks, true only if every closed week had 0 failed days', () => {
    expect(challenge('mes-perfecto-mensual').evaluate(baseContext())).toBeNull();
    expect(
      challenge('mes-perfecto-mensual').evaluate(
        baseContext({
          closedWeeksInMonth: [{ weekStartDate: '2026-02-02', failedDays: 0, penaltyCharged: 0, penaltyProtected: false }],
        })
      )
    ).toBe(true);
    expect(
      challenge('mes-perfecto-mensual').evaluate(
        baseContext({
          closedWeeksInMonth: [
            { weekStartDate: '2026-02-02', failedDays: 0, penaltyCharged: 0, penaltyProtected: false },
            { weekStartDate: '2026-02-09', failedDays: 1, penaltyCharged: 5000, penaltyProtected: false },
          ],
        })
      )
    ).toBe(false);
  });

  it('Cero Multas ignores weeks still under penalty-grace protection — a protected $0 week is not a real accomplishment', () => {
    // Only protected weeks this month -> not applicable (null), not trivially true.
    expect(
      challenge('cero-multas-mensual').evaluate(
        baseContext({
          closedWeeksInMonth: [{ weekStartDate: '2026-02-02', failedDays: 3, penaltyCharged: 0, penaltyProtected: true }],
        })
      )
    ).toBeNull();

    // A real $0 week (not protected) still earns it.
    expect(
      challenge('cero-multas-mensual').evaluate(
        baseContext({
          closedWeeksInMonth: [{ weekStartDate: '2026-02-02', failedDays: 0, penaltyCharged: 0, penaltyProtected: false }],
        })
      )
    ).toBe(true);

    // A protected week alongside a real penalty elsewhere in the month still fails it —
    // the protected week is excluded, not counted in either direction.
    expect(
      challenge('cero-multas-mensual').evaluate(
        baseContext({
          closedWeeksInMonth: [
            { weekStartDate: '2026-02-02', failedDays: 3, penaltyCharged: 0, penaltyProtected: true },
            { weekStartDate: '2026-02-09', failedDays: 1, penaltyCharged: 5000, penaltyProtected: false },
          ],
        })
      )
    ).toBe(false);
  });

  it('Festivo Cumplido is not applicable when the month has no holiday', () => {
    expect(challenge('festivo-cumplido').evaluate(baseContext({ monthHasFixedHoliday: false, completedOnHoliday: false }))).toBeNull();
    expect(challenge('festivo-cumplido').evaluate(baseContext({ monthHasFixedHoliday: true, completedOnHoliday: true }))).toBe(true);
    expect(challenge('festivo-cumplido').evaluate(baseContext({ monthHasFixedHoliday: true, completedOnHoliday: false }))).toBe(false);
  });

  it('Top del Grupo and Podio del Mes are not applicable when unranked', () => {
    expect(challenge('top-del-grupo').evaluate(baseContext({ rank: null }))).toBeNull();
    expect(challenge('top-del-grupo').evaluate(baseContext({ rank: 1 }))).toBe(true);
    expect(challenge('top-del-grupo').evaluate(baseContext({ rank: 2 }))).toBe(false);
    expect(challenge('podio-del-mes').evaluate(baseContext({ rank: 3, rankedGroupSize: 4 }))).toBe(true);
    expect(challenge('podio-del-mes').evaluate(baseContext({ rank: 4, rankedGroupSize: 4 }))).toBe(false);
  });

  it('Podio del Mes is not applicable with fewer than 4 participants that month', () => {
    expect(challenge('podio-del-mes').evaluate(baseContext({ rank: 1, rankedGroupSize: 3 }))).toBeNull();
    expect(challenge('podio-del-mes').evaluate(baseContext({ rank: 3, rankedGroupSize: 3 }))).toBeNull();
    expect(challenge('podio-del-mes').evaluate(baseContext({ rank: 1, rankedGroupSize: 4 }))).toBe(true);
  });

  it('Racha Intacta requires at least one completed day, not just zero failed days', () => {
    expect(challenge('racha-intacta-mensual').evaluate(baseContext({ completedCount: 0, failedCount: 0 }))).toBe(false);
    expect(challenge('racha-intacta-mensual').evaluate(baseContext({ completedCount: 0, failedCount: 2 }))).toBe(false);
    expect(challenge('racha-intacta-mensual').evaluate(baseContext({ completedCount: 5, failedCount: 1 }))).toBe(false);
    expect(challenge('racha-intacta-mensual').evaluate(baseContext({ completedCount: 5, failedCount: 0 }))).toBe(true);
  });

  it('Comeback del Mes requires both a current and previous rank, and a strict improvement', () => {
    expect(challenge('comeback-del-mes').evaluate(baseContext({ rank: 2, previousMonthRank: null }))).toBeNull();
    expect(challenge('comeback-del-mes').evaluate(baseContext({ rank: 2, previousMonthRank: 4 }))).toBe(true);
    expect(challenge('comeback-del-mes').evaluate(baseContext({ rank: 4, previousMonthRank: 2 }))).toBe(false);
    expect(challenge('comeback-del-mes').evaluate(baseContext({ rank: 3, previousMonthRank: 3 }))).toBe(false);
  });

  it('Doble MVP requires 2+ MVP weeks, MVP al Menos Una Vez requires only 1', () => {
    expect(challenge('mvp-al-menos-una-vez').evaluate(baseContext({ mvpWeeksThisMonth: 1 }))).toBe(true);
    expect(challenge('doble-mvp').evaluate(baseContext({ mvpWeeksThisMonth: 1 }))).toBe(false);
    expect(challenge('doble-mvp').evaluate(baseContext({ mvpWeeksThisMonth: 2 }))).toBe(true);
  });

  it('Mes de Hierro is not applicable when the group has no checkout photos', () => {
    expect(
      challenge('mes-de-hierro').evaluate(baseContext({ groupRequiresCheckoutPhoto: false, totalWorkoutMinutesInMonth: 900 }))
    ).toBeNull();
    expect(
      challenge('mes-de-hierro').evaluate(baseContext({ groupRequiresCheckoutPhoto: true, totalWorkoutMinutesInMonth: 599 }))
    ).toBe(false);
    expect(
      challenge('mes-de-hierro').evaluate(baseContext({ groupRequiresCheckoutPhoto: true, totalWorkoutMinutesInMonth: 600 }))
    ).toBe(true);
  });

  it('Rey de la Duración is not applicable when the group has no checkout photos', () => {
    expect(
      challenge('rey-de-la-duracion').evaluate(baseContext({ groupRequiresCheckoutPhoto: false, isMostDurationThisMonth: true }))
    ).toBeNull();
    expect(
      challenge('rey-de-la-duracion').evaluate(baseContext({ groupRequiresCheckoutPhoto: true, isMostDurationThisMonth: true }))
    ).toBe(true);
    expect(
      challenge('rey-de-la-duracion').evaluate(baseContext({ groupRequiresCheckoutPhoto: true, isMostDurationThisMonth: false }))
    ).toBe(false);
  });

  it('Promedio Sólido needs 3+ sessions with duration and a 40+ minute average', () => {
    expect(
      challenge('promedio-solido').evaluate(
        baseContext({ groupRequiresCheckoutPhoto: false, workoutSessionsWithDurationInMonth: 5, averageWorkoutMinutesInMonth: 50 })
      )
    ).toBeNull();
    expect(
      challenge('promedio-solido').evaluate(
        baseContext({ groupRequiresCheckoutPhoto: true, workoutSessionsWithDurationInMonth: 2, averageWorkoutMinutesInMonth: 50 })
      )
    ).toBeNull();
    expect(
      challenge('promedio-solido').evaluate(
        baseContext({ groupRequiresCheckoutPhoto: true, workoutSessionsWithDurationInMonth: 3, averageWorkoutMinutesInMonth: 39 })
      )
    ).toBe(false);
    expect(
      challenge('promedio-solido').evaluate(
        baseContext({ groupRequiresCheckoutPhoto: true, workoutSessionsWithDurationInMonth: 3, averageWorkoutMinutesInMonth: 40 })
      )
    ).toBe(true);
  });
});

describe('progress (partial-progress bar for monotonic challenges with a real threshold)', () => {
  it('Por Buen Camino and Ya Casi mi Rey report check-ins so far against their thresholds', () => {
    expect(challenge('por-buen-camino').progress!(baseContext({ completedCount: 2 }))).toEqual({ current: 2, target: 5 });
    expect(challenge('ya-casi-mi-rey').progress!(baseContext({ completedCount: 2 }))).toEqual({ current: 2, target: 15 });
  });

  it('Doble MVP reports MVP weeks so far against its threshold of 2', () => {
    expect(challenge('doble-mvp').progress!(baseContext({ mvpWeeksThisMonth: 1 }))).toEqual({ current: 1, target: 2 });
  });

  it('Motivando Ando and Motivador del Mes report reactions given so far', () => {
    expect(challenge('motivando-ando').progress!(baseContext({ reactionsGivenCount: 3 }))).toEqual({ current: 3, target: 5 });
    expect(challenge('motivador-del-mes').progress!(baseContext({ reactionsGivenCount: 3 }))).toEqual({ current: 3, target: 15 });
  });

  it('Mes de Cobre and Mes de Hierro report accumulated minutes so far', () => {
    expect(challenge('mes-de-cobre').progress!(baseContext({ totalWorkoutMinutesInMonth: 85 }))).toEqual({ current: 85, target: 200 });
    expect(challenge('mes-de-hierro').progress!(baseContext({ totalWorkoutMinutesInMonth: 85 }))).toEqual({ current: 85, target: 600 });
  });

  it('single-occurrence monotonic challenges have no progress function — a checkmark already says everything', () => {
    expect(challenge('empezamos-bien').progress).toBeUndefined();
    expect(challenge('festivo-cumplido').progress).toBeUndefined();
    expect(challenge('cuarto-contacto').progress).toBeUndefined();
    expect(challenge('mvp-al-menos-una-vez').progress).toBeUndefined();
  });

  it('non-monotonic challenges have no progress function — their live number can still move backwards before month close', () => {
    expect(challenge('top-del-grupo').progress).toBeUndefined();
    expect(challenge('racha-intacta-mensual').progress).toBeUndefined();
    expect(challenge('noventa-consistencia-mensual').progress).toBeUndefined();
  });

  it('Doble Corona and Cazador de Récords report distinct exercises claimed so far this month', () => {
    expect(challenge('doble-corona-mensual').progress!(baseContext({ kothClaimedExerciseIdsThisMonth: ['bench'] }))).toEqual({
      current: 1,
      target: 2,
    });
    expect(
      challenge('cazador-de-records').progress!(baseContext({ kothClaimedExerciseIdsThisMonth: ['bench', 'squat'] }))
    ).toEqual({ current: 2, target: 3 });
  });

  it('corona-del-mes and defensor-del-mes are single-occurrence monotonic — no progress function', () => {
    expect(challenge('corona-del-mes').progress).toBeUndefined();
    expect(challenge('defensor-del-mes').progress).toBeUndefined();
  });

  it('rey-del-mes is comparative (non-monotonic) — no progress function', () => {
    expect(challenge('rey-del-mes').progress).toBeUndefined();
  });
});

describe('King of the Hill monthly challenges', () => {
  it('corona-del-mes earns as soon as one exercise is claimed this month', () => {
    expect(challenge('corona-del-mes').evaluate(baseContext({ kothClaimedExerciseIdsThisMonth: [] }))).toBe(false);
    expect(challenge('corona-del-mes').evaluate(baseContext({ kothClaimedExerciseIdsThisMonth: ['bench'] }))).toBe(true);
  });

  it('doble-corona-mensual needs 2 distinct exercises claimed this month', () => {
    expect(challenge('doble-corona-mensual').evaluate(baseContext({ kothClaimedExerciseIdsThisMonth: ['bench'] }))).toBe(false);
    expect(
      challenge('doble-corona-mensual').evaluate(baseContext({ kothClaimedExerciseIdsThisMonth: ['bench', 'squat'] }))
    ).toBe(true);
  });

  it('cazador-de-records needs 3 distinct exercises claimed this month', () => {
    expect(
      challenge('cazador-de-records').evaluate(baseContext({ kothClaimedExerciseIdsThisMonth: ['bench', 'squat'] }))
    ).toBe(false);
    expect(
      challenge('cazador-de-records').evaluate(
        baseContext({ kothClaimedExerciseIdsThisMonth: ['bench', 'squat', 'deadlift'] })
      )
    ).toBe(true);
  });

  it('defensor-del-mes reads the precomputed defended-this-month flag', () => {
    expect(challenge('defensor-del-mes').evaluate(baseContext({ kothDefendedThisMonth: false }))).toBe(false);
    expect(challenge('defensor-del-mes').evaluate(baseContext({ kothDefendedThisMonth: true }))).toBe(true);
  });

  it('rey-del-mes reads the precomputed cross-member "most active KOTH exercises this month" flag', () => {
    expect(challenge('rey-del-mes').evaluate(baseContext({ isKothKingThisMonth: false }))).toBe(false);
    expect(challenge('rey-del-mes').evaluate(baseContext({ isKothKingThisMonth: true }))).toBe(true);
  });
});
