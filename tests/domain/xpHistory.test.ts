import { buildXpHistory } from '@/lib/domain/xpHistory';
import type { BadgeStatus } from '@/lib/domain/badges';
import type { KothClaimFact } from '@/lib/domain/koth';
import type { MonthlyChallengeStatus } from '@/lib/domain/monthlyChallenges';

function status(overrides: Partial<BadgeStatus> = {}): BadgeStatus {
  return { earned: true, current: 1, target: 1, earnedDate: '2026-01-01', ...overrides };
}

function monthlyStatus(overrides: Partial<MonthlyChallengeStatus> = {}): MonthlyChallengeStatus {
  return { timesAchieved: 0, monthsEvaluated: 0, currentMonthEarned: null, currentMonthProgress: null, earnedMonths: [], ...overrides };
}

let nextClaimId = 1;
function claim(overrides: Partial<KothClaimFact> & Pick<KothClaimFact, 'exerciseId'>): KothClaimFact {
  return {
    id: `claim-${nextClaimId++}`,
    userId: 'a',
    metricType: 'weight_kg',
    status: 'valid',
    createdAt: '2026-01-01T00:00:00Z',
    decidedAt: null,
    wasChallenged: false,
    ...overrides,
  };
}

describe('buildXpHistory', () => {
  it('includes only badges that are earned AND have a non-null earnedDate', () => {
    const statuses = {
      'primer-paso': status({ earned: true, earnedDate: '2026-01-05' }),
      // earned but no derivable date (e.g. the KOTH "N at once" family) — must not appear.
      'mes-perfecto': status({ earned: true, earnedDate: null }),
      leyenda: status({ earned: false, earnedDate: null }),
    };
    const entries = buildXpHistory(statuses, {}, [], {});
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: 'Primer Paso', date: '2026-01-05', source: 'badge' });
  });

  it('emits one entry per earnedMonths entry for a monthly challenge, dated to the last day of that month', () => {
    const monthlyStatuses = { 'empezamos-bien': monthlyStatus({ earnedMonths: ['2026-02', '2026-04'] }) };
    const entries = buildXpHistory({}, monthlyStatuses, [], {});
    expect(entries.map((e) => e.date)).toEqual(['2026-04-30', '2026-02-28']);
    expect(entries[0].title).toContain('(mensual)');
    expect(entries[0].xp).toBe(10);
    expect(entries.every((e) => e.source === 'monthly')).toBe(true);
  });

  it('includes only valid KOTH claims, using decidedAt over createdAt when present', () => {
    const claims = [
      claim({ exerciseId: 'bench', status: 'valid', createdAt: '2026-01-01T00:00:00Z', decidedAt: '2026-01-04T00:00:00Z' }),
      claim({ exerciseId: 'squat', status: 'pending_vote', createdAt: '2026-01-10T00:00:00Z' }),
      claim({ exerciseId: 'deadlift', status: 'invalidated', createdAt: '2026-01-15T00:00:00Z', decidedAt: '2026-01-16T00:00:00Z' }),
    ];
    const entries = buildXpHistory({}, {}, claims, { bench: 'Bench Press' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: '2026-01-04T00:00:00Z', title: 'Bench Press', xp: 50, source: 'koth' });
  });

  it('falls back to createdAt for a valid claim with no decidedAt', () => {
    const claims = [claim({ exerciseId: 'bench', status: 'valid', createdAt: '2026-01-01T00:00:00Z', decidedAt: null })];
    const entries = buildXpHistory({}, {}, claims, { bench: 'Bench Press' });
    expect(entries[0].date).toBe('2026-01-01T00:00:00Z');
  });

  it('sorts descending by date across all three sources', () => {
    const statuses = { 'primer-paso': status({ earnedDate: '2026-01-01' }) };
    const monthlyStatuses = { 'empezamos-bien': monthlyStatus({ earnedMonths: ['2026-02'] }) };
    const claims = [claim({ exerciseId: 'bench', createdAt: '2026-03-01T00:00:00Z', decidedAt: '2026-03-01T00:00:00Z' })];
    const entries = buildXpHistory(statuses, monthlyStatuses, claims, { bench: 'Bench Press' });
    expect(entries.map((e) => e.source)).toEqual(['koth', 'monthly', 'badge']);
  });

  it('omits the check-ins running total when checkinXpTotal is 0 (the default)', () => {
    const entries = buildXpHistory({}, {}, [], {});
    expect(entries.some((e) => e.source === 'checkins')).toBe(false);
  });

  it('pins an undated check-ins running-total entry first, ahead of every dated entry', () => {
    const statuses = { 'primer-paso': status({ earnedDate: '2026-01-01' }) };
    const entries = buildXpHistory(statuses, {}, [], {}, 235);
    expect(entries[0]).toMatchObject({ date: null, xp: 235, source: 'checkins' });
    expect(entries).toHaveLength(2);
  });
});
