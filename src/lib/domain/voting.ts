/**
 * Reference implementation of the majority-vote resolution logic that also
 * lives in resolve_rule_proposal() / close_expired_proposals()
 * (supabase/migrations/0007_functions_triggers.sql). The database trigger
 * is authoritative; this mirrors it for unit testing and for previewing
 * "X more yes votes needed" in the UI without a round trip.
 */

export type ProposalOutcome = 'pending' | 'approved' | 'rejected';

export interface VoteTally {
  yes: number;
  no: number;
}

/** floor(memberCount / 2) + 1 — matches propose_rule_change()'s snapshot. */
export function computeRequiredVotes(memberCount: number): number {
  if (memberCount < 0 || !Number.isInteger(memberCount)) {
    throw new Error('memberCount must be a non-negative integer');
  }
  return Math.floor(memberCount / 2) + 1;
}

/**
 * Early-resolution check: approved once a majority is mathematically
 * reached, rejected once a majority is mathematically impossible. Otherwise
 * stays pending until either more votes arrive or the voting window closes
 * (see resolveOnTimeout).
 */
export function tallyOutcome(
  tally: VoteTally,
  requiredVotes: number,
  memberCountSnapshot: number
): ProposalOutcome {
  if (tally.yes >= requiredVotes) return 'approved';
  if (tally.no > memberCountSnapshot - requiredVotes) return 'rejected';
  return 'pending';
}

/**
 * What close_expired_proposals()/close_expired_excuse_votes() do to a
 * request whose voting window lapsed without an early resolution: defaults
 * to approved ("es un Sí") rather than staying open or rejecting — a group
 * that doesn't vote isn't allowed to silently reject by inaction, that's on
 * the members who didn't show up, not on the person waiting on them.
 */
export function resolveOnTimeout(): 'approved' {
  return 'approved';
}
