/**
 * MET (metabolic equivalent) for a typical resistance-training session,
 * set-and-rest structure included — the Compendium of Physical Activities
 * lists "resistance training, multiple exercises, 8-15 reps" at 3.5
 * (light-to-moderate effort) up to 6.0 (vigorous effort). This uses a
 * middle value representative of a normal working set with rest between,
 * not just the lifting itself.
 */
export const WEIGHT_TRAINING_MET = 4.5;

/** Used only when neither Health/Health Connect's own body-mass record nor the member's profile has a body weight on file — a generic adult average, not personalized to anyone in particular. */
export const DEFAULT_BODY_WEIGHT_KG = 70;

/**
 * Standard MET-based calorie estimate: MET × weight(kg) × duration(hours),
 * rounded to the nearest whole kcal. This is what replaces the old "read
 * whatever the phone passively tracked" number — without an actively
 * tracked workout (e.g. no Apple Watch session running), a phone's own
 * accelerometer-based estimate badly undercounts resistance training, so
 * this app-computed estimate is deliberately independent of Health/Health
 * Connect's own passive numbers, then written back to them afterward (see
 * appleHealth.ts/healthConnect.ts) rather than read from them.
 */
export function estimateWorkoutCalories(durationSeconds: number, bodyWeightKg: number = DEFAULT_BODY_WEIGHT_KG): number {
  const hours = Math.max(0, durationSeconds) / 3600;
  return Math.round(WEIGHT_TRAINING_MET * bodyWeightKg * hours);
}
