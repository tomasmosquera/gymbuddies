import { computeRadarValues, percentileAmong, RADAR_AXES, type MemberSummary } from '@/lib/domain/personalStatsV2';

function member(overrides: Partial<MemberSummary> = {}): MemberSummary {
  return {
    userId: 'u',
    fullName: 'Member',
    gbScore: 50,
    consistencyPercent: 50,
    currentStreak: 0,
    longestStreak: 0,
    totalCheckins: 0,
    totalMinutes: null,
    avgMinutes: null,
    totalCalories: null,
    totalPenalties: 0,
    level: 1,
    totalXp: 0,
    earnedBadgesCount: 0,
    kothValidClaims: 0,
    daysAsMember: 1,
    totalVolumeKg: 0,
    reactionsGivenTotal: 0,
    reactionsReceivedTotal: 0,
    ...overrides,
  };
}

describe('percentileAmong', () => {
  it('is 100 when beating everyone else', () => {
    expect(percentileAmong(10, [1, 2, 3])).toBe(100);
  });

  it('is 0 when beating nobody', () => {
    expect(percentileAmong(1, [5, 10])).toBe(0);
  });

  it('is null with no comparable others', () => {
    expect(percentileAmong(10, [])).toBeNull();
    expect(percentileAmong(10, [null])).toBeNull();
  });

  it('is null when my own value is null', () => {
    expect(percentileAmong(null, [1, 2])).toBeNull();
  });
});

describe('computeRadarValues', () => {
  it('has one value per RADAR_AXES entry', () => {
    const values = computeRadarValues(member(), [member(), member({ userId: 'b' })]);
    expect(values).toHaveLength(RADAR_AXES.length);
  });

  it('gives the strongest member 100 on an axis where they clearly lead', () => {
    const strong = member({ userId: 'a', totalVolumeKg: 10000 });
    const weak = member({ userId: 'b', totalVolumeKg: 100 });
    const values = computeRadarValues(strong, [strong, weak]);
    const fuerzaIndex = RADAR_AXES.findIndex((a) => a.label === 'Fuerza');
    expect(values[fuerzaIndex]).toBe(100);
  });

  it('gives the weakest member 0 on that same axis', () => {
    const strong = member({ userId: 'a', totalVolumeKg: 10000 });
    const weak = member({ userId: 'b', totalVolumeKg: 100 });
    const values = computeRadarValues(weak, [strong, weak]);
    const fuerzaIndex = RADAR_AXES.findIndex((a) => a.label === 'Fuerza');
    expect(values[fuerzaIndex]).toBe(0);
  });

  it('inverts penalties for Finanzas — fewer penalties scores higher', () => {
    const disciplined = member({ userId: 'a', totalPenalties: 0 });
    const penalized = member({ userId: 'b', totalPenalties: 50000 });
    const values = computeRadarValues(disciplined, [disciplined, penalized]);
    const finanzasIndex = RADAR_AXES.findIndex((a) => a.label === 'Finanzas');
    expect(values[finanzasIndex]).toBe(100);
  });

  it('combines given + received reactions for Social', () => {
    const social = member({ userId: 'a', reactionsGivenTotal: 20, reactionsReceivedTotal: 30 });
    const quiet = member({ userId: 'b', reactionsGivenTotal: 0, reactionsReceivedTotal: 0 });
    const values = computeRadarValues(social, [social, quiet]);
    const socialIndex = RADAR_AXES.findIndex((a) => a.label === 'Social');
    expect(values[socialIndex]).toBe(100);
  });

  it('defaults every axis to 50 when there is nobody else to compare against', () => {
    const values = computeRadarValues(member(), [member()]);
    expect(values).toEqual(RADAR_AXES.map(() => 50));
  });

  it('excludes the member themself from their own comparison pool', () => {
    // If self weren't excluded, a lone strong member compared against a
    // pool that includes their own huge value would drag their percentile
    // down below 100 (beating "everyone" except themselves, still counted).
    const onlyMember = member({ userId: 'a', totalVolumeKg: 10000 });
    const values = computeRadarValues(onlyMember, [onlyMember]);
    const fuerzaIndex = RADAR_AXES.findIndex((a) => a.label === 'Fuerza');
    expect(values[fuerzaIndex]).toBe(50); // no one else at all -> the "undefined" default, not a real rank
  });
});
