import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { AppNotification } from '@/lib/supabase/types';

const MAX_NOTIFICATIONS = 20;

/**
 * A unified inbox across every group the member belongs to — mirrors what
 * already landed on their phone as a push, but persisted so it can be
 * reviewed later. Written by send_push_notification (see migration 0053);
 * this hook only reads. "Unread" is a single last_notifications_seen_at
 * timestamp on the profile, not a per-row flag — good enough for a bell dot
 * and a "new" marker per item, without needing per-row read tracking.
 */
export function useNotifications() {
  const { session } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const userId = session?.user.id;
    if (!userId) {
      setNotifications([]);
      setLastSeenAt(null);
      setIsLoading(false);
      setLoadedForUserId(null);
      return;
    }
    if (loadedForUserId !== userId) setIsLoading(true);

    const [notificationsRes, profileRes] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(MAX_NOTIFICATIONS),
      supabase.from('profiles').select('last_notifications_seen_at').eq('id', userId).single(),
    ]);

    setNotifications(notificationsRes.data ?? []);
    setLastSeenAt(profileRes.data?.last_notifications_seen_at ?? null);
    setIsLoading(false);
    setLoadedForUserId(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const hasUnread = notifications.some((n) => !lastSeenAt || n.created_at > lastSeenAt);

  const markSeen = useCallback(async () => {
    const now = new Date().toISOString();
    setLastSeenAt(now);
    await supabase.rpc('mark_notifications_seen');
  }, []);

  return { notifications, lastSeenAt, hasUnread, isLoading, refresh, markSeen };
}
