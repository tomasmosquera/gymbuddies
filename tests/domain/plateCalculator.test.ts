import { calculatePlateBreakdown, formatPlateBreakdown } from '@/lib/domain/plateCalculator';

describe('calculatePlateBreakdown', () => {
  it('splits an exact target into the fewest standard plates, largest first', () => {
    expect(calculatePlateBreakdown(85, 20, 'kg')).toEqual({ plates: [20, 10, 2.5], perSide: 32.5, leftover: 0 });
  });

  it('is empty (just the bar) when the target is at or below the bar weight', () => {
    expect(calculatePlateBreakdown(20, 20, 'kg')).toEqual({ plates: [], perSide: 0, leftover: 0 });
    expect(calculatePlateBreakdown(15, 20, 'kg')).toEqual({ plates: [], perSide: 0, leftover: 0 });
  });

  it('reports a leftover instead of silently rounding when the target cannot be built exactly', () => {
    const result = calculatePlateBreakdown(61, 20, 'kg'); // perSide = 20.5, not reachable with 1.25 steps below 1
    expect(result.plates).toEqual([20]);
    expect(result.leftover).toBeCloseTo(0.5, 5);
  });

  it('never drifts into a bogus leftover from floating-point subtraction', () => {
    // perSide = 33.75 = 20 + 10 + 2.5 + 1.25 exactly — a naive single-rounding-at-the-end
    // implementation can leave a tiny leftover like 1.2499999999999998 here.
    const result = calculatePlateBreakdown(87.5, 20, 'kg');
    expect(result.plates).toEqual([20, 10, 2.5, 1.25]);
    expect(result.leftover).toBe(0);
  });

  it('uses the lbs plate set (45/35/25/10/5/2.5), never the kg one, when unit is lbs', () => {
    expect(calculatePlateBreakdown(135, 45, 'lbs')).toEqual({ plates: [45], perSide: 45, leftover: 0 });
    expect(calculatePlateBreakdown(185, 45, 'lbs')).toEqual({ plates: [45, 25], perSide: 70, leftover: 0 });
  });

  it('a target below zero perSide (bar heavier than the target) never goes negative', () => {
    expect(calculatePlateBreakdown(0, 20, 'kg').perSide).toBe(0);
  });
});

describe('formatPlateBreakdown', () => {
  it('joins plates largest to smallest with the unit label', () => {
    const breakdown = calculatePlateBreakdown(85, 20, 'kg');
    expect(formatPlateBreakdown(breakdown, 'kg')).toBe('20 + 10 + 2.5 kg por lado');
  });

  it('says so explicitly when there are no plates at all', () => {
    const breakdown = calculatePlateBreakdown(20, 20, 'kg');
    expect(formatPlateBreakdown(breakdown, 'kg')).toBe('Sin discos — solo la barra');
  });
});
