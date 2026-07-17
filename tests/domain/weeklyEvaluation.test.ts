import { daysPresentInWeek, evaluateWeek } from '@/lib/domain/weeklyEvaluation';

describe('evaluateWeek', () => {
  it('charges no penalty when the member met their required days', () => {
    const result = evaluateWeek({
      requiredDaysPerWeek: 3,
      daysPresentInWeek: 7,
      completedDays: 3,
      vacationDaysUsed: 0,
      penaltyAmount: 10000,
      balanceBefore: 50000,
    });
    expect(result).toEqual({
      requiredDays: 3,
      effectiveRequiredDays: 3,
      failedDays: 0,
      penaltyCharged: 0,
      balanceAfter: 50000,
      statusAfter: 'active',
    });
  });

  it('charges one penalty per missed day', () => {
    const result = evaluateWeek({
      requiredDaysPerWeek: 4,
      daysPresentInWeek: 7,
      completedDays: 1,
      vacationDaysUsed: 0,
      penaltyAmount: 10000,
      balanceBefore: 50000,
    });
    expect(result.failedDays).toBe(3);
    expect(result.penaltyCharged).toBe(30000);
    expect(result.balanceAfter).toBe(20000);
    expect(result.statusAfter).toBe('active');
  });

  it('lets vacation days excuse required days without counting as failures', () => {
    const result = evaluateWeek({
      requiredDaysPerWeek: 3,
      daysPresentInWeek: 7,
      completedDays: 1,
      vacationDaysUsed: 2,
      penaltyAmount: 10000,
      balanceBefore: 50000,
    });
    expect(result.effectiveRequiredDays).toBe(1);
    expect(result.failedDays).toBe(0);
    expect(result.penaltyCharged).toBe(0);
  });

  it('caps effective required days at zero when vacation days exceed the requirement', () => {
    const result = evaluateWeek({
      requiredDaysPerWeek: 2,
      daysPresentInWeek: 7,
      completedDays: 0,
      vacationDaysUsed: 5,
      penaltyAmount: 10000,
      balanceBefore: 50000,
    });
    expect(result.effectiveRequiredDays).toBe(0);
    expect(result.failedDays).toBe(0);
  });

  it('never counts more completed days than required as negative failures', () => {
    const result = evaluateWeek({
      requiredDaysPerWeek: 2,
      daysPresentInWeek: 7,
      completedDays: 5,
      vacationDaysUsed: 0,
      penaltyAmount: 10000,
      balanceBefore: 50000,
    });
    expect(result.failedDays).toBe(0);
  });

  it('flips to needs_recharge exactly when the balance reaches zero or below', () => {
    const exact = evaluateWeek({
      requiredDaysPerWeek: 2,
      daysPresentInWeek: 7,
      completedDays: 0,
      vacationDaysUsed: 0,
      penaltyAmount: 25000,
      balanceBefore: 50000,
    });
    expect(exact.balanceAfter).toBe(0);
    expect(exact.statusAfter).toBe('needs_recharge');

    const over = evaluateWeek({
      requiredDaysPerWeek: 3,
      daysPresentInWeek: 7,
      completedDays: 0,
      vacationDaysUsed: 0,
      penaltyAmount: 25000,
      balanceBefore: 50000,
    });
    expect(over.balanceAfter).toBe(-25000);
    expect(over.statusAfter).toBe('needs_recharge');
  });

  it('stays active when the balance remains positive after penalties', () => {
    const result = evaluateWeek({
      requiredDaysPerWeek: 2,
      daysPresentInWeek: 7,
      completedDays: 0,
      vacationDaysUsed: 0,
      penaltyAmount: 10000,
      balanceBefore: 50000,
    });
    expect(result.balanceAfter).toBe(30000);
    expect(result.statusAfter).toBe('active');
  });

  describe('partial week (joined mid-week)', () => {
    it('shrinks required days to how many days the member was actually present for', () => {
      // Required 3/week, but only joined with 2 days left (e.g. Saturday).
      const result = evaluateWeek({
        requiredDaysPerWeek: 3,
        daysPresentInWeek: 2,
        completedDays: 0,
        vacationDaysUsed: 0,
        penaltyAmount: 10000,
        balanceBefore: 50000,
      });
      expect(result.requiredDays).toBe(2);
    });

    it('never inflates the requirement above the group setting even with a full week present', () => {
      const result = evaluateWeek({
        requiredDaysPerWeek: 3,
        daysPresentInWeek: 7,
        completedDays: 0,
        vacationDaysUsed: 0,
        penaltyAmount: 10000,
        balanceBefore: 50000,
      });
      expect(result.requiredDays).toBe(3);
    });

    it('charges no penalty for a member who joined too late to owe any days at all', () => {
      const result = evaluateWeek({
        requiredDaysPerWeek: 3,
        daysPresentInWeek: 0,
        completedDays: 0,
        vacationDaysUsed: 0,
        penaltyAmount: 10000,
        balanceBefore: 50000,
      });
      expect(result.requiredDays).toBe(0);
      expect(result.failedDays).toBe(0);
      expect(result.penaltyCharged).toBe(0);
    });
  });
});

describe('daysPresentInWeek', () => {
  it('returns 7 for a member present for the whole Mon..Sun week', () => {
    expect(daysPresentInWeek('2026-07-10', '2026-07-13', '2026-07-19')).toBe(7);
  });

  it('counts only from the join date through the end of the week', () => {
    // Joined Thursday: Thu, Fri, Sat, Sun = 4 days.
    expect(daysPresentInWeek('2026-07-16', '2026-07-13', '2026-07-19')).toBe(4);
  });

  it('returns 1 when joining on the last day of the week', () => {
    expect(daysPresentInWeek('2026-07-19', '2026-07-13', '2026-07-19')).toBe(1);
  });

  it('clamps to 0 when the activation date is after the week entirely', () => {
    expect(daysPresentInWeek('2026-07-25', '2026-07-13', '2026-07-19')).toBe(0);
  });
});
