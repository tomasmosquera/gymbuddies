import { formatCompactNumber, formatWeightUnit, kgToLbs, kgToUnit, lbsToKg, sanitizeWeightInput, unitToKg } from '@/lib/domain/workoutUnits';

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

describe('formatCompactNumber', () => {
  it('shows the plain rounded number under 1000, no suffix', () => {
    expect(formatCompactNumber(543)).toBe('543');
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(0)).toBe('0');
  });

  it('matches the exact example from the request: 26000 -> "26k"', () => {
    expect(formatCompactNumber(26000)).toBe('26k');
  });

  it('drops a trailing .0 for a whole number of thousands', () => {
    expect(formatCompactNumber(1000)).toBe('1k');
  });

  it('keeps one decimal for a genuine fraction of a thousand', () => {
    expect(formatCompactNumber(1200)).toBe('1.2k');
  });

  it('rounds to at most one decimal, never more', () => {
    expect(formatCompactNumber(1234)).toBe('1.2k');
    expect(formatCompactNumber(1250)).toBe('1.3k'); // rounds .25k up to .3k, not .25k
  });

  it('switches to M at a million', () => {
    expect(formatCompactNumber(3_400_000)).toBe('3.4M');
    expect(formatCompactNumber(1_000_000)).toBe('1M');
  });

  it('handles negatives the same way, sign preserved', () => {
    expect(formatCompactNumber(-26000)).toBe('-26k');
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
