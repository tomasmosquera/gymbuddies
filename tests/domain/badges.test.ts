import {
  BADGES,
  completedStreakRuns,
  longestCompletedStreak,
  currentCompletedStreak,
  weekendWarriorRun,
  monthlyConsistency,
  longestConsecutiveMonthRun,
  monthlyPenalties,
  isFixedHoliday,
  totalWorkoutMinutes,
  longestSingleWorkoutMinutes,
  bestSustainedAverageWorkout,
  type BadgeCheckinFact,
  type BadgeContext,
  type BadgeDayRecord,
} from '@/lib/domain/badges';

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
    reactionsGivenDates: [],
    reactionsGivenByRecipient: {},
    reactionsReceivedCount: 0,
    ruleProposalsWonCount: 0,
    ...overrides,
  };
}

function badge(id: string) {
  const found = BADGES.find((b) => b.id === id);
  if (!found) throw new Error(`missing badge ${id}`);
  return found;
}

describe('badge catalog', () => {
  it('has exactly 47 badges with unique ids', () => {
    expect(BADGES.length).toBe(47);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(47);
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
    expect(badge('primer-paso').evaluate(ctx)).toEqual({ earned: true, current: 1, target: 1 });
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

  it('Fan Número Uno needs 20 reactions given to the same recipient', () => {
    expect(badge('fan-numero-uno').evaluate(baseContext({ reactionsGivenByRecipient: { alice: 19, bob: 5 } })).earned).toBe(false);
    expect(badge('fan-numero-uno').evaluate(baseContext({ reactionsGivenByRecipient: { alice: 20, bob: 5 } })).earned).toBe(true);
  });

  it('Alma del Grupo needs 30 consecutive calendar days of reactions given', () => {
    const consecutive = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    expect(badge('alma-del-grupo').evaluate(baseContext({ reactionsGivenDates: consecutive })).earned).toBe(true);
    expect(badge('alma-del-grupo').evaluate(baseContext({ reactionsGivenDates: consecutive.slice(0, 29) })).earned).toBe(false);
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
