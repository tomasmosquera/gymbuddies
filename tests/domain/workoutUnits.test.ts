import { formatWeightUnit, kgToLbs, kgToUnit, lbsToKg, sanitizeWeightInput, unitToKg } from '@/lib/domain/workoutUnits';

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

  it('keeps one decimal in lbs too — small plates move in half-pound increments', () => {
    expect(kgToUnit(100, 'lbs')).toBe(220.5);
    expect(kgToUnit(11.57, 'lbs')).toBeCloseTo(25.5, 1);
  });
});

describe('formatWeightUnit', () => {
  it('always shows exactly one decimal, even for a whole number', () => {
    expect(formatWeightUnit(60, 'kg')).toBe('60.0');
  });

  it('matches the exact examples: 10kg -> 22.0lbs, 20.5kg -> 45.2lbs', () => {
    expect(formatWeightUnit(10, 'lbs')).toBe('22.0');
    expect(formatWeightUnit(20.5, 'lbs')).toBe('45.2');
  });

  it('never shows more than one decimal digit, even from an ugly conversion', () => {
    // 27.65kg -> ~60.98lbs raw, would read as "60.99"-ish noise unrounded.
    expect(formatWeightUnit(27.65, 'lbs')).toMatch(/^\d+\.\d$/);
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
