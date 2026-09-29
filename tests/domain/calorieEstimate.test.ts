import { DEFAULT_BODY_WEIGHT_KG, WEIGHT_TRAINING_MET, estimateWorkoutCalories } from '@/lib/domain/calorieEstimate';

describe('estimateWorkoutCalories', () => {
  it('applies MET x weight x hours, rounded to the nearest kcal', () => {
    // 4.5 MET x 70kg x 1h = 315
    expect(estimateWorkoutCalories(3600, 70)).toBe(Math.round(WEIGHT_TRAINING_MET * 70));
  });

  it('scales with duration', () => {
    const oneHour = estimateWorkoutCalories(3600, 70);
    const halfHour = estimateWorkoutCalories(1800, 70);
    // Within 1 kcal, not an exact match — both are independently rounded.
    expect(Math.abs(halfHour - oneHour / 2)).toBeLessThanOrEqual(1);
  });

  it('scales with body weight', () => {
    const at70 = estimateWorkoutCalories(3600, 70);
    const at100 = estimateWorkoutCalories(3600, 100);
    expect(at100).toBeGreaterThan(at70);
  });

  it('uses the default body weight when none is given', () => {
    expect(estimateWorkoutCalories(3600)).toBe(estimateWorkoutCalories(3600, DEFAULT_BODY_WEIGHT_KG));
  });

  it('never goes negative, even with a negative duration', () => {
    expect(estimateWorkoutCalories(-100, 70)).toBe(0);
  });

  it('is 0 for a zero-duration session', () => {
    expect(estimateWorkoutCalories(0, 70)).toBe(0);
  });
});
