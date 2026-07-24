/**
 * Mirrors the fixed emoji set and aggregation rule that also lives in
 * checkin_reactions' CHECK constraint and react_to_checkin()
 * (supabase/migrations/0047_checkin_reactions.sql). The database is
 * authoritative; this is for validating input client-side before a round
 * trip and for rendering per-emoji counts.
 */

export const REACTION_EMOJIS = ['💪🏼', '🔥', '🫃'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isValidReactionEmoji(value: string): value is ReactionEmoji {
  return (REACTION_EMOJIS as readonly string[]).includes(value);
}

/** One check-in, one reaction per user (react_to_checkin upserts on conflict) — just tallies by emoji. */
export function aggregateReactionCounts(reactions: readonly { emoji: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reaction of reactions) {
    counts[reaction.emoji] = (counts[reaction.emoji] ?? 0) + 1;
  }
  return counts;
}
