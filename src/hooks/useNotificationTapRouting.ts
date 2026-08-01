import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { getNotificationRoute } from '@/lib/notifications/notificationRouting';
import type { NotificationCategory } from '@/lib/supabase/types';

/**
 * Routes to the relevant screen when the user taps a real push notification
 * — both a cold start (app was fully closed, opened by tapping one) and a
 * tap while the app is warm/backgrounded, via the same reactive value
 * (`useLastNotificationResponse` already covers both cases in one hook).
 * `category`/`group_id` are folded into every push's `data` payload
 * server-side (send_push_notification, see the notification-routing
 * migration) specifically so this never needs a DB round-trip before
 * navigating — the same getNotificationRoute used for the in-app inbox
 * (app/(app)/profile/notifications.tsx) drives both.
 */
export function useNotificationTapRouting() {
  const { session } = useAuth();
  const response = Notifications.useLastNotificationResponse();
  const handledIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    if (handledIdRef.current === response.notification.request.identifier) return;
    handledIdRef.current = response.notification.request.identifier;

    const data = response.notification.request.content.data as Record<string, unknown>;
    const category = typeof data.category === 'string' ? (data.category as NotificationCategory) : null;
    const groupId = typeof data.group_id === 'string' ? data.group_id : null;

    const route = getNotificationRoute({ category, data });
    if (!route) return;
    if (groupId) useActiveGroupStore.getState().setActiveGroupId(groupId);
    router.push(route);
  }, [session, response]);
}
