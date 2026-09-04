import type { Ionicons } from '@expo/vector-icons';
import type { NotificationCategory } from '@/lib/supabase/types';

/** Shared display helpers for anywhere a notification-shaped row is rendered
 * as a list — the in-app inbox (profile/notifications.tsx) and the group
 * admin panel's "Actividad reciente" feed, which reads the same rows scoped
 * to one group instead of across all of them. */

export const CATEGORY_ICONS: Record<NotificationCategory, keyof typeof Ionicons.glyphMap> = {
  group_activity: 'people-outline',
  money: 'cash-outline',
  votes: 'checkmark-done-outline',
  reminders: 'alarm-outline',
  admin_actions: 'shield-checkmark-outline',
  achievements: 'trophy-outline',
};

export function iconFor(category: NotificationCategory | null): keyof typeof Ionicons.glyphMap {
  return category ? (CATEGORY_ICONS[category] ?? 'notifications-outline') : 'notifications-outline';
}

export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Justo ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
  const date = new Date(isoDate);
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
