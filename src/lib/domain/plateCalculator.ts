import { kgToUnit, type WeightUnit } from '@/lib/domain/workoutUnits';

/** Standard gym plate denominations, largest first — same order the greedy breakdown below fills
 * from, which also happens to match how you'd actually load a bar (biggest plates closest in). */
export const KG_PLATES: readonly number[] = [20, 15, 10, 5, 2.5, 1.25];
export const LBS_PLATES: readonly number[] = [45, 35, 25, 10, 5, 2.5];

export interface BarWeightPreset {
  kg: number;
  /** The marketed lbs equivalent — a 20kg bar is sold/labeled as "44 lb", not the
   * physics-precise 44.1 a plain kg->lbs conversion gives (same for the 15kg "33 lb" short bar).
   * The 10kg EZ bar needs no override: it already rounds cleanly to 22.0. */
  lbs: number;
  label: string;
}

export const BAR_WEIGHT_PRESETS: readonly BarWeightPreset[] = [
  { kg: 20, lbs: 44, label: 'Estándar' },
  { kg: 15, lbs: 33, label: 'Corta' },
  { kg: 10, lbs: 22, label: 'EZ' },
];

/** The bar weight to actually use for plate math/display, in `unit` — looks up the marketed lbs
 * value for a standard preset (see BAR_WEIGHT_PRESETS) instead of a plain conversion, since gym
 * bars are bought and labeled by that nicer number, not the precise metric equivalent. Any other
 * (custom) bar weight has no such marketed equivalent, so it falls back to a plain conversion. */
export function barWeightInUnit(barKg: number, unit: WeightUnit): number {
  if (unit === 'kg') return barKg;
  const preset = BAR_WEIGHT_PRESETS.find((p) => p.kg === barKg);
  return preset ? preset.lbs : kgToUnit(barKg, unit);
}

export interface PlateBreakdown {
  /** One entry per plate needed on ONE side, largest first — both sides are identical, so the UI
   * only ever needs to show this once. Empty when the target doesn't exceed the bar's own weight. */
  plates: readonly number[];
  /** (target - bar) / 2, never negative — what plates has to add up to on one side. */
  perSide: number;
  /** > 0 when perSide can't be reached exactly with the available denominations (e.g. an odd
   * target with only whole plates down to 2.5) — the UI shows this as a "doesn't land exactly"
   * note instead of silently rounding. */
  leftover: number;
}

/**
 * How many plates of each size go on ONE side of the bar to reach `targetWeight` total — pure, no
 * knowledge of exercises/sets, just arithmetic. `targetWeight` and `barWeight` are both in `unit`
 * (the caller converts from canonical kg first, same as every other weight already shown in the UI)
 * so the breakdown is reported in plates a member would actually recognize at their own gym — a kg
 * gym's 20/15/10/5/2.5/1.25 or an lbs gym's 45/35/25/10/5/2.5, never a value converted between the
 * two mid-calculation.
 */
export function calculatePlateBreakdown(targetWeight: number, barWeight: number, unit: WeightUnit): PlateBreakdown {
  const denominations = unit === 'kg' ? KG_PLATES : LBS_PLATES;
  const perSide = Math.max(0, (targetWeight - barWeight) / 2);
  const plates: number[] = [];
  // Rounds after every subtraction, not just once at the end — repeated floating-point
  // subtraction (33.75 - 20 - 10 - ...) drifts into values like 1.2499999999999998, which would
  // otherwise fail the 1.25 comparison below by a hair and get misreported as leftover.
  let remaining = Math.round(perSide * 100) / 100;
  for (const denom of denominations) {
    while (remaining + 1e-6 >= denom) {
      plates.push(denom);
      remaining = Math.round((remaining - denom) * 100) / 100;
    }
  }
  return { plates, perSide, leftover: Math.max(0, remaining) };
}

/** "20 + 10 + 2.5 kg por lado", or an explicit "sin discos" / "no se puede armar exacto" instead
 * of leaving the member to guess why the numbers don't add up. */
export function formatPlateBreakdown(breakdown: PlateBreakdown, unit: WeightUnit): string {
  if (breakdown.plates.length === 0) return 'Sin discos — solo la barra';
  return `${breakdown.plates.map(String).join(' + ')} ${unit} por lado`;
}
