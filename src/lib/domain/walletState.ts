/**
 * Small derived-state helpers for the wallet UI. Pure display math — the
 * actual balance is only ever mutated server-side (apply_wallet_transaction_effect()).
 */

/**
 * How many more fully-failed days the member can absorb before their
 * balance drops to zero or below. Returns null when there's no penalty
 * configured (failing never costs anything, so recharge never triggers).
 */
export function failsRemaining(balance: number, penaltyAmount: number): number | null {
  if (penaltyAmount <= 0) return null;
  return Math.max(Math.floor(balance / penaltyAmount), 0);
}

/** True once a member has used up all the fails their deposit covered. */
export function needsRecharge(balance: number): boolean {
  return balance <= 0;
}
