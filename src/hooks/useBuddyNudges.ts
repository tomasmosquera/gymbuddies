import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString } from '@/lib/domain/dateUtils';

const COOLDOWN_MS = 12 * 60 * 60 * 1000;

interface NudgeState {
  countToday: number;
  lastSentAtToday: number | null; // epoch ms, easiest to diff against Date.now()
}

/**
 * "Bud" — my own nudges sent TODAY (the group's own calendar day) in this
 * group (RLS on buddy_nudges only ever lets me read my own), so the UI can
 * hide the 👋🏼 exactly when the server would reject it: 2 already sent
 * today, or the 12h cooldown since the last one to that person hasn't
 * elapsed yet. Only ever looking at today's own rows is deliberate — send_
 * buddy_nudge's cooldown check does the same (0119_buddy_nudge_cooldown_
 * resets_at_midnight.sql), so a nudge sent late yesterday never bleeds into
 * blocking today: the day rolling over at midnight clears the cooldown even
 * if less than 12h have actually passed. This is a UX head start only — the
 * real cap/cooldown is enforced server-side.
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
    const { data } = await supabase
      .from('buddy_nudges')
      .select('recipient_id, sent_at')
      .eq('group_id', groupId)
      .eq('sent_date', todayString);

    const next = new Map<string, NudgeState>();
    for (const row of (data ?? []) as { recipient_id: string; sent_at: string }[]) {
      const entry = next.get(row.recipient_id) ?? { countToday: 0, lastSentAtToday: null };
      entry.countToday += 1;
      const sentAtMs = new Date(row.sent_at).getTime();
      if (entry.lastSentAtToday === null || sentAtMs > entry.lastSentAtToday) entry.lastSentAtToday = sentAtMs;
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
        const entry = next.get(recipientId) ?? { countToday: 0, lastSentAtToday: null };
        next.set(recipientId, { countToday: entry.countToday + 1, lastSentAtToday: Date.now() });
        return next;
      });
    },
    [groupId]
  );

  /** True when Bud would actually let me nudge this person right now — under the 2/day cap and past the 12h cooldown since my last one to them today (a new calendar day clears the cooldown regardless of the 12h — see refresh() above). */
  const canNudge = useCallback(
    (recipientId: string): boolean => {
      const entry = stateByRecipient.get(recipientId);
      if (!entry) return true;
      if (entry.countToday >= 2) return false;
      if (entry.lastSentAtToday !== null && Date.now() - entry.lastSentAtToday < COOLDOWN_MS) return false;
      return true;
    },
    [stateByRecipient]
  );

  return { canNudge, isLoading, refresh, sendNudge };
}
