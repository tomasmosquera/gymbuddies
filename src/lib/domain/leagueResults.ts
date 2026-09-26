/** One member's final standing in a closed Liga cycle. */
export interface LeagueResultRow {
  userId: string;
  fullName: string;
  /** Tie-aware: members tied share the same number (two 1st places → no 2nd). */
  place: number;
  /** Completed days minus failed days across the cycle — what the ranking is sorted by. */
  score: number;
  /** What this member was paid out of the pool (0 when their place pays nothing). */
  prizeAmount: number;
  /** Finished in the relegation zone (Liga with descenso only). */
  relegated: boolean;
  /** What relegation cost them — 0 when the zone does not charge. */
  descensoAmount: number;
}

/** Everything the "cycle closed" modal shows. */
export interface LeagueCycleResults {
  cycleNumber: number;
  /** YYYY-MM-DD of the first / last day of the cycle. */
  startDate: string;
  endDate: string;
  closedEarly: boolean;
  currency: string;
  /** Total pool that was shared out. */
  poolAmount: number;
  /** A new cycle already started (auto-renew) — otherwise the Liga is paused until the admin starts one. */
  autoRenewed: boolean;
  /** Ascending by place. */
  standings: LeagueResultRow[];
  /** Only the paid places are known (the cycle predates the full-standings record) — the modal says so instead of implying nobody else played. */
  partial?: boolean;
}

/** Everyone in the relegation zone. */
export function relegatedOf(standings: LeagueResultRow[]): LeagueResultRow[] {
  return standings.filter((r) => r.relegated);
}

/** Everyone who finished 1st (ties included) — the ones who wear the crown. */
export function championsOf(standings: LeagueResultRow[]): LeagueResultRow[] {
  return standings.filter((r) => r.place === 1);
}

/** "Ana", "Ana y Beto", "Ana, Beto y Caro". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** The big line under the crown — written for whoever is looking at it. */
export function congratsHeadline(results: LeagueCycleResults, myUserId: string | null): string {
  const champs = championsOf(results.standings);
  const mine = results.standings.find((r) => r.userId === myUserId);
  if (mine && mine.place === 1) {
    return champs.length > 1
      ? `¡Felicitaciones! Compartes la corona con ${joinNames(champs.filter((c) => c.userId !== mine.userId).map((c) => firstName(c.fullName)))}.`
      : '¡Felicitaciones, campeón! La corona es tuya.';
  }
  if (mine && mine.place <= 3) return '¡Gran ciclo! Subiste al podio.';
  const names = joinNames(champs.map((c) => firstName(c.fullName)));
  return champs.length > 1 ? `Felicitaciones a ${names}, campeones del ciclo.` : `Felicitaciones a ${names}, campeón del ciclo.`;
}

/** "Quedaste 2° de 8" — null when the viewer didn't play this cycle. */
export function myPlaceLine(results: LeagueCycleResults, myUserId: string | null): string | null {
  const mine = results.standings.find((r) => r.userId === myUserId);
  if (!mine) return null;
  return `Quedaste ${mine.place}° de ${results.standings.length}`;
}

/** What the history fetch knows about one member of a settled cycle — from the full standings when they exist, else from the payouts alone. */
export interface CycleStandingSource {
  userId: string;
  fullName: string | null;
  place: number;
  score: number;
  prizeAmount: number;
  relegated: boolean;
  descensoAmount: number;
}

/** Turns a settled cycle + its standings into what LeagueCycleResultsModal renders. Dates are already calendar strings in the group's timezone. */
export function toCycleResults(input: {
  cycleNumber: number;
  startDate: string;
  endDate: string;
  closedEarly: boolean;
  currency: string;
  poolAmount: number | null;
  partial: boolean;
  rows: CycleStandingSource[];
}): LeagueCycleResults {
  return {
    cycleNumber: input.cycleNumber,
    startDate: input.startDate,
    endDate: input.endDate,
    closedEarly: input.closedEarly,
    currency: input.currency,
    poolAmount: input.poolAmount ?? 0,
    autoRenewed: false,
    partial: input.partial,
    standings: input.rows
      .map((r) => ({
        userId: r.userId,
        fullName: r.fullName ?? 'Ex miembro',
        place: r.place,
        score: r.score,
        prizeAmount: r.prizeAmount,
        relegated: r.relegated,
        descensoAmount: r.descensoAmount,
      }))
      .sort((a, b) => a.place - b.place || a.fullName.localeCompare(b.fullName)),
  };
}
