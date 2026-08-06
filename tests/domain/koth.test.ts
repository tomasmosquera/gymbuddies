import { beatsCurrentRecord, formatKothValue, kgToLbs, lbsToKg, toCanonicalValue } from '@/lib/domain/koth';

describe('lbsToKg / kgToLbs', () => {
  it('round-trips within floating point tolerance', () => {
    expect(lbsToKg(220)).toBeCloseTo(99.79, 1);
    expect(kgToLbs(100)).toBeCloseTo(220.46, 1);
    expect(kgToLbs(lbsToKg(185))).toBeCloseTo(185, 5);
  });
});

describe('toCanonicalValue', () => {
  it('passes reps through unchanged, ignoring any unit', () => {
    expect(toCanonicalValue('reps', 12, null)).toBe(12);
  });

  it('keeps kg as-is', () => {
    expect(toCanonicalValue('weight_kg', 100, 'kg')).toBe(100);
  });

  it('converts lbs to kg', () => {
    expect(toCanonicalValue('weight_kg', 220, 'lbs')).toBeCloseTo(99.79, 1);
  });
});

describe('formatKothValue', () => {
  it('formats reps as a singular/plural rep count', () => {
    expect(formatKothValue('reps', 1)).toBe('1 rep');
    expect(formatKothValue('reps', 12)).toBe('12 reps');
  });

  it('formats weight in both kg and lbs', () => {
    expect(formatKothValue('weight_kg', 100)).toBe('100 kg (220.5 lbs)');
  });
});

describe('beatsCurrentRecord', () => {
  it('accepts any positive value when there is no current record', () => {
    expect(beatsCurrentRecord('weight_kg', 50, 'kg', null)).toBe(true);
  });

  it('requires strictly greater — a tie does not dethrone', () => {
    expect(beatsCurrentRecord('weight_kg', 100, 'kg', 100)).toBe(false);
  });

  it('rejects a weaker claim', () => {
    expect(beatsCurrentRecord('weight_kg', 90, 'kg', 100)).toBe(false);
  });

  it('accepts a stronger claim submitted in a different unit than the record is stored in', () => {
    // 250 lbs ≈ 113.4kg > 100kg record
    expect(beatsCurrentRecord('weight_kg', 250, 'lbs', 100)).toBe(true);
  });

  it('compares reps directly with no conversion', () => {
    expect(beatsCurrentRecord('reps', 15, null, 12)).toBe(true);
    expect(beatsCurrentRecord('reps', 10, null, 12)).toBe(false);
  });
});
