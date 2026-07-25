import { BADGES } from '@/lib/domain/badges';

/**
 * XP per badge, graded by how hard each one actually is to earn. One badge —
 * 'ahorrador-involuntario' — is the sole revocable achievement in the whole
 * catalog (see badges.ts: it uses .every(), so a single future penalty wipes
 * it out forever). It's deliberately worth 0 XP so a level can never go
 * DOWN — everything else in the catalog is monotonic (once true, always
 * true), which is what keeps XP itself monotonic too.
 */
export const XP_BY_BADGE_ID: Record<string, number> = {
  // Rachas
  'primer-paso': 20,
  'semana-fuerte': 50,
  'mes-perfecto': 100,
  inquebrantable: 200,
  leyenda: 500,
  'segunda-oportunidad': 50,
  fenix: 300,
  'finde-guerrero': 100,
  'sin-excusas': 20,

  // Consistencia
  metodico: 100,
  impecable: 200,
  'constante-de-verdad': 300,
  veterano: 100,
  'el-fundador': 20,
  'por-algo-se-empieza': 20,
  'cero-multas-mes': 50,
  'trimestre-solido': 100,
  'ano-impecable': 500,

  // Fechas especiales
  'proposito-ano-nuevo': 20,
  'sin-descanso-navideno': 50,
  aniversario: 20,

  // Check-ins
  'say-cheese': 20,
  'ubicacion-verificada': 50,
  'madrugador-novato': 50,
  'madrugador-experto': 100,
  'buho-novato': 50,
  'buho-experto': 100,
  coleccionista: 100,
  'los-365': 300,
  maratonista: 100,
  'ultra-maratonista': 400,
  'entreno-de-hierro': 50,
  'maquina-de-resistencia': 150,
  'constancia-de-acero': 200,

  // Financiero
  'piel-en-el-juego': 20,
  'ahorrador-involuntario': 0,
  'el-propio-gordo': 20,

  // Social
  motivador: 20,
  'el-mas-querido': 100,
  'fan-numero-uno': 50,
  'alma-del-grupo': 300,
  reformista: 50,
};

export function xpForBadge(badgeId: string): number {
  return XP_BY_BADGE_ID[badgeId] ?? 0;
}

export function totalXpForEarnedBadges(earnedBadgeIds: readonly string[]): number {
  return earnedBadgeIds.reduce((sum, id) => sum + xpForBadge(id), 0);
}

/** Every badge in the catalog has an assigned XP value (0 counts, e.g. the revocable one). */
export function hasCompleteXpTable(): boolean {
  return BADGES.every((b) => Object.prototype.hasOwnProperty.call(XP_BY_BADGE_ID, b.id));
}

/**
 * Incremental XP needed to go from level-1 to level: 100 for level 1, then
 * +50 per subsequent level (100, 150, 200, 250, ...), matching the exact
 * progression the user specified.
 */
export function xpRequiredForLevel(level: number): number {
  if (level < 1) return 0;
  return 100 + 50 * (level - 1);
}

/** Total XP needed, starting from 0, to reach `level`. */
export function cumulativeXpForLevel(level: number): number {
  if (level < 1) return 0;
  // Closed form of sum_{k=1}^{level} (100 + 50*(k-1)) = 25*level*(level+3).
  return 25 * level * (level + 3);
}

export interface LevelProgress {
  level: number;
  totalXp: number;
  /** XP earned within the current level, i.e. progress toward the next one. */
  currentLevelXp: number;
  /** XP needed to go from this level to the next. */
  xpForNextLevel: number;
  /** currentLevelXp / xpForNextLevel, in [0, 1). */
  progress: number;
}

export function levelProgress(totalXp: number): LevelProgress {
  let level = 0;
  while (cumulativeXpForLevel(level + 1) <= totalXp) level++;
  const currentLevelXp = totalXp - cumulativeXpForLevel(level);
  const xpForNextLevel = xpRequiredForLevel(level + 1);
  return { level, totalXp, currentLevelXp, xpForNextLevel, progress: currentLevelXp / xpForNextLevel };
}
