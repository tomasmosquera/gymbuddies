import { evaluateWeek } from '@/lib/domain/weeklyEvaluation';

describe('evaluateWeek', () => {
  it('charges no penalty when the member met their required days', () => {
    const result = evaluateWeek({
      requiredDaysPerWeek: 3,
      completedDays: 3,
      vacationDaysUsed: 0,
      penaltyAmount: 10000,
      balanceBefore: 50000,
    });
    expect(result).toEqual({
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
      completedDays: 0,
      vacationDaysUsed: 0,
      penaltyAmount: 25000,
      balanceBefore: 50000,
    });
    expect(exact.balanceAfter).toBe(0);
    expect(exact.statusAfter).toBe('needs_recharge');

    const over = evaluateWeek({
      requiredDaysPerWeek: 3,
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
      completedDays: 0,
      vacationDaysUsed: 0,
      penaltyAmount: 10000,
      balanceBefore: 50000,
    });
    expect(result.balanceAfter).toBe(30000);
    expect(result.statusAfter).toBe('active');
  });
});
