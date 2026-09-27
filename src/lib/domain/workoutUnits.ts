export type WeightUnit = 'kg' | 'lbs';

const KG_PER_LB = 0.45359237;

/** Everything is stored/compared in kg — this is only for what a member types/reads on their own screens (Profile.weight_unit). */
export function kgToLbs(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

/** Rounded to a sane display precision: whole-ish kg gets 1 decimal, lbs (bigger numbers) gets none. */
export function kgToUnit(kg: number, unit: WeightUnit): number {
  if (unit === 'kg') return Math.round(kg * 10) / 10;
  return Math.round(kgToLbs(kg));
}

/** The inverse of kgToUnit — what a member typed, in `unit`, converted to canonical kg for the server (which re-derives it anyway; this is only for optimistic UI). */
export function unitToKg(value: number, unit: WeightUnit): number {
  return unit === 'lbs' ? lbsToKg(value) : value;
}
