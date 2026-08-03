import type { Href } from 'expo-router';
import type { NotificationCategory } from '@/lib/supabase/types';

export interface RoutableNotification {
  category: NotificationCategory | null;
  data: Record<string, unknown> | null | undefined;
}

// A switch (not a Record<NotificationCategory, Href> lookup) deliberately —
// indexing a Record of Href (a large generated union from every typed
// route in the app) can blow past TS's type-complexity budget as the
// route tree grows; literal returns per case stay cheap to check.
function categoryDefaultRoute(category: NotificationCategory): Href {
  switch (category) {
    case 'achievements':
      return '/profile/badges';
    case 'money':
      return '/profile/wallet';
    case 'votes':
      return '/rules';
    case 'group_activity':
      return '/dashboard';
    case 'admin_actions':
      return '/dashboard';
    case 'reminders':
      return '/checkin';
  }
}

/**
 * Where tapping a notification (in-app inbox row, or a real push) should
 * navigate. `category` alone is the default router — it's right for most
 * notifications in each category (reactions/photos -> Dashboard, vote
 * outcomes -> Rules, recharge/penalty results -> Wallet, etc.). A handful of
 * send_push_notification call sites are the *admin's own* copy of a
 * notification whose right destination differs from that default (or a
 * group_activity case that isn't really "go look at the Dashboard") — those
 * carry an explicit `data.route` string, checked first. Returns null for
 * anything unrecognized rather than guessing at a destination.
 */
export function getNotificationRoute(n: RoutableNotification): Href | null {
  const route = typeof n.data?.route === 'string' ? n.data.route : null;

  switch (route) {
    case 'removed':
      return '/group-select';
    case 'leave':
      return '/rules';
    case 'new_member':
      return '/profile/admin-members';
    case 'admin_review':
      // Reused across two categories — the category itself disambiguates.
      if (n.category === 'money') return '/profile/admin-transactions';
      if (n.category === 'votes') return '/profile/excuse-admin';
      break;
  }

  if (n.category === 'achievements') {
    const userId = typeof n.data?.user_id === 'string' ? n.data.user_id : null;
    return userId ? { pathname: '/profile/badges', params: { userId } } : '/profile/badges';
  }

  if (!n.category) return null;
  return categoryDefaultRoute(n.category);
}
