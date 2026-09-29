export type WeightUnit = 'kg' | 'lbs';

const KG_PER_LB = 0.45359237;

/** Everything is stored/compared in kg — this is only for what a member types/reads on their own screens (Profile.weight_unit). */
export function kgToLbs(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

/**
 * Rounded to one decimal place, in either unit. lbs used to round to a
 * whole number — small dumbbells/cable stacks often move in half-pound
 * increments (25.5 lbs is a real plate), and rounding those away made a
 * logged set look like its decimal had silently been dropped, even though
 * it was stored correctly (this is purely a display conversion — to_kg on
 * the server already keeps 2 decimals of kg regardless of unit).
 */
export function kgToUnit(kg: number, unit: WeightUnit): number {
  const value = unit === 'kg' ? kg : kgToLbs(kg);
  return Math.round(value * 10) / 10;
}

/** The inverse of kgToUnit — what a member typed, in `unit`, converted to canonical kg for the server (which re-derives it anyway; this is only for optimistic UI). */
export function unitToKg(value: number, unit: WeightUnit): number {
  return unit === 'lbs' ? lbsToKg(value) : value;
}

/**
 * Strips a weight TextInput down to digits + one decimal separator, and
 * normalizes a comma to a period — es-* keyboards' `decimal-pad` often types
 * "," for the decimal point (Spanish locale convention), and a naive
 * digits-and-period filter silently ate it, making decimals impossible to
 * enter on those devices even though `Number()` parses "60.5" just fine.
 */
export function sanitizeWeightInput(raw: string): string {
  return raw.replace(/[^0-9.,]/g, '').replace(',', '.');
}
