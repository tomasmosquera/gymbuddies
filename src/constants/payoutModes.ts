import type { PayoutMode } from '@/lib/supabase/types';

export const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = {
  cooperative: 'Cooperativo',
  league: 'Liga',
  mixed: 'Mixto',
};

export const PAYOUT_MODE_DESCRIPTIONS: Record<PayoutMode, string> = {
  cooperative:
    'Cada integrante activo tiene una parte igual del fondo común. Al salir del grupo, se lleva esa parte proporcional del saldo acumulado hasta ese momento.',
  league:
    'Todo el fondo se reparte entre los primeros lugares del ranking al final de cada ciclo. No hay penalizaciones por días fallados — entrena 7 días o ninguno, solo cuenta tu puesto al terminar el ciclo.',
  mixed:
    'Combina los dos modos: una parte del fondo se reparte como premio de Liga según el ranking, y el resto se reparte por igual entre todos como en Cooperativo (con las mismas penalizaciones por días fallados).',
};

export type ModeSpecificField = 'attendanceRules' | 'leagueConfig' | 'mixedShare';

/**
 * Whether a rule field is relevant for a payout mode — used to hide fields
 * a mode doesn't use, in group creation and rule-change screens alike.
 * - attendanceRules: min_days_per_week / penalty_amount / weekly_penalty_cap
 *   — meaningless in pure Liga (no weekly penalties are ever charged there).
 * - leagueConfig: league_duration_months / league_prize_splits — only
 *   matters once a podium payout can happen (Liga or Mixto).
 * - mixedShare: mixed_league_share_percent — only meaningful in Mixto.
 */
export function isFieldRelevantForMode(field: ModeSpecificField, mode: PayoutMode): boolean {
  switch (field) {
    case 'attendanceRules':
      return mode !== 'league';
    case 'leagueConfig':
      return mode !== 'cooperative';
    case 'mixedShare':
      return mode === 'mixed';
  }
}
