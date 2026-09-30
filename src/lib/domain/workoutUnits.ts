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
 * kgToUnit, formatted to ALWAYS show exactly one decimal place ("22.0", not
 * just "22") — for read-only display text (the "Anterior" column, "Última
 * vez", past-session history). kgToUnit's own rounding is already correct
 * (nearest 0.1); this only fixes the STRING conversion afterward, where a
 * whole-number result like 22.0 silently becomes "22" (JS drops a trailing
 * .0), which read as an inconsistent number of decimals next to sibling
 * rows that do show one. Editable inputs keep the plain kgToUnit number
 * instead — forcing a trailing zero on a field still being typed into would
 * be intrusive mid-keystroke.
 */
export function formatWeightUnit(kg: number, unit: WeightUnit): string {
  return kgToUnit(kg, unit).toFixed(1);
}

/**
 * "26k" for 26000, "1.2k" for 1200, "3.4M" for 3400000 — a large aggregate
 * (e.g. "Volumen total levantado" across every set ever logged) read as a
 * wall of digits otherwise. Under 1000 shows the plain rounded number, no
 * suffix. Trims a trailing ".0" (e.g. 1000 -> "1k", not "1.0k") but keeps a
 * genuine decimal (1200 -> "1.2k") — one decimal max, always rounded, never
 * exact past that.
 */
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  const trimmed = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (abs < 1000) return String(Math.round(value));
  if (abs < 1_000_000) return `${trimmed(Math.round((value / 1000) * 10) / 10)}k`;
  return `${trimmed(Math.round((value / 1_000_000) * 10) / 10)}M`;
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
