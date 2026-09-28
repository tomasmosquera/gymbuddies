import { kgToLbs, kgToUnit, lbsToKg, sanitizeWeightInput, unitToKg } from '@/lib/domain/workoutUnits';

describe('kgToLbs / lbsToKg', () => {
  it('round-trips (within floating-point tolerance)', () => {
    expect(kgToLbs(100)).toBeCloseTo(220.462, 2);
    expect(lbsToKg(220.462)).toBeCloseTo(100, 2);
    expect(lbsToKg(kgToLbs(60))).toBeCloseTo(60, 6);
  });
});

describe('kgToUnit', () => {
  it('keeps one decimal in kg', () => {
    expect(kgToUnit(60, 'kg')).toBe(60);
    expect(kgToUnit(60.449, 'kg')).toBe(60.4);
    expect(kgToUnit(60.451, 'kg')).toBe(60.5);
  });

  it('rounds to a whole number in lbs', () => {
    expect(kgToUnit(100, 'lbs')).toBe(220);
  });
});

describe('unitToKg', () => {
  it('passes kg through unchanged and converts lbs', () => {
    expect(unitToKg(60, 'kg')).toBe(60);
    expect(unitToKg(220, 'lbs')).toBeCloseTo(99.79, 1);
  });
});

describe('sanitizeWeightInput', () => {
  it('keeps digits and a period as-is', () => {
    expect(sanitizeWeightInput('60.5')).toBe('60.5');
  });

  it('normalizes a comma decimal separator to a period (es-* decimal-pad keyboards)', () => {
    expect(sanitizeWeightInput('60,5')).toBe('60.5');
  });

  it('strips anything that is not a digit, period, or comma', () => {
    expect(sanitizeWeightInput('60kg')).toBe('60');
    expect(sanitizeWeightInput('abc')).toBe('');
  });
});
