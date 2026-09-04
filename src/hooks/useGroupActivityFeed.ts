import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { AppNotification } from '@/lib/supabase/types';

// Every send_push_notification call site for "%s ha terminado su entreno de
// hoy." (the checkout-photo fanout to teammates, see
// 0099_checkout_fanout_ignores_auto_created.sql) uses this exact fixed
// Spanish template with no data.route marker to match on instead — too
// frequent/low-signal for an admin oversight feed (that's what the
// Dashboard's attendance view is for), so it's excluded at the query level
// rather than client-side, to keep page counts/hasMore accurate.
const WORKOUT_FINISHED_BODY_FILTER = '%ha terminado su entreno de hoy%';

/**
 * "Actividad reciente" on the group admin panel — the same notifications
 * infrastructure behind the personal inbox (useNotifications), scoped to
 * one group instead of all of them. Deliberately reuses whatever
 * send_push_notification already decided this admin should be told about
 * (deposits to confirm, leave requests, excuses, votes, new members, KOTH
 * claims, ...) rather than building a second, separate activity log —
 * there's no extra filtering to keep in sync as new notification types are
 * added elsewhere. Ordinary check-ins don't show up here either: they never
 * generate a notification (too frequent/low-signal for a push), so this
 * reads as "what needs your eyes", not a full attendance log.
 *
 * Paginated in `pageSize`-sized pages (keyset via offset/range, ordered by
 * created_at desc) — the admin panel's inline preview uses a small page
 * (10) and never calls loadMore, just checks hasMore to show "Ver más"; the
 * full-screen activity list uses a bigger page (20) with infinite scroll.
 */
export function useGroupActivityFeed(groupId: string | null, userId: string | null, pageSize: number) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const fetchPage = useCallback(
    async (offset: number): Promise<{ rows: AppNotification[]; more: boolean }> => {
      if (!groupId || !userId) return { rows: [], more: false };
      // Fetch one extra row past the page to detect whether another page
      // exists, without a separate count query.
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .not('body', 'ilike', WORKOUT_FINISHED_BODY_FILTER)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize);
      const rows = data ?? [];
      return { rows: rows.slice(0, pageSize), more: rows.length > pageSize };
    },
    [groupId, userId, pageSize]
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const { rows, more } = await fetchPage(0);
    setItems(rows);
    setHasMore(more);
    setIsLoading(false);
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const { rows, more } = await fetchPage(items.length);
    setItems((prev) => [...prev, ...rows]);
    setHasMore(more);
    setIsLoadingMore(false);
  }, [fetchPage, items.length, hasMore, isLoadingMore]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh's own identity already changes with groupId/userId/pageSize (its dep), re-running this is what we want; including refresh itself would re-fire on every items-driven fetchPage change too.
  }, [groupId, userId, pageSize]);

  return { items, hasMore, isLoading, isLoadingMore, refresh, loadMore };
}
