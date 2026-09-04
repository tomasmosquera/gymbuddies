import { BADGES, type BadgeStatus } from '@/lib/domain/badges';
import { lastDayOfMonth } from '@/lib/domain/dateUtils';
import type { KothClaimFact } from '@/lib/domain/koth';
import { MONTHLY_CHALLENGES, type MonthlyChallengeStatus } from '@/lib/domain/monthlyChallenges';
import { KOTH_CLAIM_XP, xpForBadge } from '@/lib/domain/xp';

export interface XpHistoryEntry {
  /** YYYY-MM-DD for badge/monthly entries; a full ISO timestamp for KOTH entries (see buildXpHistory's sort, which compares only the date portion so this difference never skews ordering); null only for the check-ins running total, which isn't tied to any single date. */
  date: string | null;
  emoji: string;
  title: string;
  xp: number;
  source: 'badge' | 'monthly' | 'koth' | 'checkins';
}

/**
 * Assembles a member's full XP-granting history from data already computed
 * elsewhere (badges.ts's earnedDate per badge, monthlyChallenges' earnedMonths
 * per challenge, and this member's own valid KOTH claims) — purely a
 * presentation-layer merge, no new computation. Sorted most-recent-first,
 * matching the "what did I earn recently" framing this was built for.
 *
 * checkinXpTotal (5 XP per valid check-in, see xp.ts's checkinXp) is the one
 * exception: one entry per check-in would flood this list, so instead it's
 * folded into a single running-total row pinned at the very top, undated
 * (date: null) since it doesn't correspond to any one moment.
 */
export function buildXpHistory(
  statuses: Record<string, BadgeStatus>,
  monthlyStatuses: Record<string, MonthlyChallengeStatus>,
  kothClaims: readonly KothClaimFact[],
  exerciseNameById: Record<string, string>,
  checkinXpTotal = 0
): XpHistoryEntry[] {
  const entries: XpHistoryEntry[] = [];

  for (const b of BADGES) {
    const status = statuses[b.id];
    if (!status?.earned || !status.earnedDate) continue;
    entries.push({ date: status.earnedDate, emoji: b.emoji, title: b.name, xp: xpForBadge(b.id), source: 'badge' });
  }

  for (const c of MONTHLY_CHALLENGES) {
    const status = monthlyStatuses[c.id];
    if (!status) continue;
    for (const month of status.earnedMonths) {
      entries.push({
        date: lastDayOfMonth(month),
        emoji: c.emoji,
        title: `${c.name} (mensual)`,
        xp: c.xpPerOccurrence,
        source: 'monthly',
      });
    }
  }

  for (const claim of kothClaims) {
    if (claim.status !== 'valid') continue;
    entries.push({
      date: claim.decidedAt ?? claim.createdAt,
      emoji: '👑',
      title: exerciseNameById[claim.exerciseId] ?? 'Ejercicio',
      xp: KOTH_CLAIM_XP,
      source: 'koth',
    });
  }

  // Compare only the YYYY-MM-DD portion: KOTH entries carry a full ISO
  // timestamp while badge/monthly entries are date-only, and comparing the
  // full strings would always sort a same-day KOTH entry "later" than a
  // same-day badge/monthly one — a string-length artifact, not real
  // chronology (this screen only ever displays a date, not a time, so a
  // same-day tie-break doesn't need to be exact). Every entry pushed above
  // always carries a real date string, so this sort never has to deal with
  // the null case.
  const sorted = entries.sort((a, b) => (b.date as string).slice(0, 10).localeCompare((a.date as string).slice(0, 10)));

  if (checkinXpTotal > 0) {
    sorted.unshift({ date: null, emoji: '🎯', title: 'Check-ins válidos', xp: checkinXpTotal, source: 'checkins' });
  }

  return sorted;
}
