/**
 * Payout math for the Liga/Cooperativo/Mixto group modes — pure mirrors of
 * the SQL in pay_out_departing_member/evaluate_due_league_cycle
 * (supabase/migrations/0063_payout_mode_rpcs.sql), kept here (not in
 * attendance.ts) because that file's ranking is explicitly money-free.
 * Client-side use is preview-only (e.g. "you'll get ~$X if you leave now")
 * — the real payout is always computed and applied server-side.
 */

export interface LeaguePlacement {
  userId: string;
  /** 1-based prize slot this member's tie-group starts at (standard competition ranking: ties share the lowest slot they jointly occupy). */
  place: number;
  /** Prize-split percent for this place, merged across every slot a tie-group jointly consumes and split evenly among its members. */
  sharePercent: number;
}

/**
 * Maps an already-computed rank (e.g. from rankMembersByConsistency) to
 * prize placements. A group of k members tied at rank `place` jointly
 * consumes prize slots [place, place+k-1] — merging (summing) those slots'
 * percentages and splitting evenly among the tied members. Ranks beyond the
 * configured prize splits simply receive nothing — no recipient is ever
 * fabricated for an unfilled slot.
 */
export function computeLeaguePlacements(
  rankByUserId: ReadonlyMap<string, number>,
  prizeSplitsPercent: readonly number[]
): LeaguePlacement[] {
  const usersByPlace = new Map<number, string[]>();
  for (const [userId, place] of rankByUserId) {
    const group = usersByPlace.get(place);
    if (group) group.push(userId);
    else usersByPlace.set(place, [userId]);
  }

  const placements: LeaguePlacement[] = [];
  const sortedPlaces = [...usersByPlace.keys()].sort((a, b) => a - b);
  for (const place of sortedPlaces) {
    if (place > prizeSplitsPercent.length) continue;
    const userIds = usersByPlace.get(place)!;
    const lastSlot = Math.min(place + userIds.length - 1, prizeSplitsPercent.length);
    let mergedPercent = 0;
    for (let slot = place; slot <= lastSlot; slot++) {
      mergedPercent += prizeSplitsPercent[slot - 1];
    }
    mergedPercent /= userIds.length;
    for (const userId of [...userIds].sort()) {
      placements.push({ userId, place, sharePercent: mergedPercent });
    }
  }
  return placements;
}

/**
 * A departing member's equal 1/N share of the pool (Cooperativo), or of
 * just the cooperative slice of it (Mixto, via mixedLeagueSharePercent — the
 * % of the pool that instead follows the league mechanic). N includes the
 * departing member themselves, matching pay_out_departing_member's own
 * "lock everyone active, including the one about to leave" semantics.
 */
export function computeCooperativeShare(
  poolTotal: number,
  activeMemberCount: number,
  mixedLeagueSharePercent?: number
): number {
  if (activeMemberCount <= 0) return 0;
  const coopPool = mixedLeagueSharePercent != null ? poolTotal * (1 - mixedLeagueSharePercent / 100) : poolTotal;
  return Math.max(Math.round((coopPool / activeMemberCount) * 100) / 100, 0);
}
