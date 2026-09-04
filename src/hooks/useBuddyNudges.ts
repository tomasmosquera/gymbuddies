import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString } from '@/lib/domain/dateUtils';

const COOLDOWN_MS = 12 * 60 * 60 * 1000;
// Wide enough to always catch the last nudge even if it landed yesterday
// (the 12h cooldown can span midnight) — the 2/day cap is judged separately
// against each row's own sent_date, not this window.
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

interface NudgeState {
  countToday: number;
  lastSentAt: number | null; // epoch ms, easiest to diff against Date.now()
}

/**
 * "Bud" — my own recent nudges in this group (RLS on buddy_nudges only ever
 * lets me read my own), so the UI can hide the 👋🏼 exactly when the server
 * would reject it: 2 already sent today, or the 12h cooldown since the last
 * one to that person hasn't elapsed yet. This is a UX head start only — the
 * real cap/cooldown is enforced server-side in send_buddy_nudge.
 */
export function useBuddyNudges(groupId: string | null, timezone: string) {
  const [stateByRecipient, setStateByRecipient] = useState<Map<string, NudgeState>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setStateByRecipient(new Map());
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const todayString = toZonedDateString(new Date(), timezone);
    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
    const { data } = await supabase
      .from('buddy_nudges')
      .select('recipient_id, sent_at, sent_date')
      .eq('group_id', groupId)
      .gte('sent_at', since);

    const next = new Map<string, NudgeState>();
    for (const row of (data ?? []) as { recipient_id: string; sent_at: string; sent_date: string }[]) {
      const entry = next.get(row.recipient_id) ?? { countToday: 0, lastSentAt: null };
      if (row.sent_date === todayString) entry.countToday += 1;
      const sentAtMs = new Date(row.sent_at).getTime();
      if (entry.lastSentAt === null || sentAtMs > entry.lastSentAt) entry.lastSentAt = sentAtMs;
      next.set(row.recipient_id, entry);
    }
    setStateByRecipient(next);
    setIsLoading(false);
  }, [groupId, timezone]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sendNudge = useCallback(
    async (recipientId: string) => {
      if (!groupId) return;
      const { error } = await supabase.rpc('send_buddy_nudge', { p_group_id: groupId, p_recipient_id: recipientId });
      if (error) throw new Error(error.message);
      // Optimistic bump — a manual refresh() would also work but this avoids
      // the round trip just to reflect a state we already know changed.
      setStateByRecipient((prev) => {
        const next = new Map(prev);
        const entry = next.get(recipientId) ?? { countToday: 0, lastSentAt: null };
        next.set(recipientId, { countToday: entry.countToday + 1, lastSentAt: Date.now() });
        return next;
      });
    },
    [groupId]
  );

  /** True when Bud would actually let me nudge this person right now — under the 2/day cap and past the 12h cooldown since my last one to them. */
  const canNudge = useCallback(
    (recipientId: string): boolean => {
      const entry = stateByRecipient.get(recipientId);
      if (!entry) return true;
      if (entry.countToday >= 2) return false;
      if (entry.lastSentAt !== null && Date.now() - entry.lastSentAt < COOLDOWN_MS) return false;
      return true;
    },
    [stateByRecipient]
  );

  return { canNudge, isLoading, refresh, sendNudge };
}
