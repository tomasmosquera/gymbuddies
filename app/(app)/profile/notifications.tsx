import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useNotifications } from '@/hooks/useNotifications';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { getNotificationRoute } from '@/lib/notifications/notificationRouting';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import type { AppNotification, NotificationCategory } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

const CATEGORY_ICONS: Record<NotificationCategory, keyof typeof Ionicons.glyphMap> = {
  group_activity: 'people-outline',
  money: 'cash-outline',
  votes: 'checkmark-done-outline',
  reminders: 'alarm-outline',
  admin_actions: 'shield-checkmark-outline',
  achievements: 'trophy-outline',
};

function iconFor(category: NotificationCategory | null): keyof typeof Ionicons.glyphMap {
  return category ? CATEGORY_ICONS[category] ?? 'notifications-outline' : 'notifications-outline';
}

function formatRelativeTime(isoDate: string): string {
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

function handlePressNotification(n: AppNotification) {
  const route = getNotificationRoute(n);
  if (!route) return;
  // The notification's own group, which may not be the one currently active
  // (a member can belong to several groups) — the destination screen needs
  // to show that group's data, not whatever was active before the tap.
  useActiveGroupStore.getState().setActiveGroupId(n.group_id);
  router.push(route);
}

export default function NotificationsScreen() {
  const { notifications, lastSeenAt, isLoading, markSeen } = useNotifications();

  useEffect(() => {
    markSeen();
    // Only once per mount — opening this screen is what "seeing" means here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (notifications.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Sin notificaciones"
          description="Aquí verás las últimas novedades del grupo: votaciones, entrenos de tus compañeros, retos logrados y más."
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {notifications.map((n) => {
        const isNew = !lastSeenAt || n.created_at > lastSeenAt;
        return (
          <Card key={n.id}>
            <Pressable style={styles.row} onPress={() => handlePressNotification(n)}>
              <View style={styles.iconWrap}>
                <Ionicons name={iconFor(n.category)} size={20} color={colors.text} />
              </View>
              <View style={styles.body}>
                <View style={styles.titleLine}>
                  <Text style={styles.title} numberOfLines={2}>
                    {n.title}
                  </Text>
                  {isNew ? <View style={styles.newDot} /> : null}
                </View>
                <Text style={styles.description}>{n.body}</Text>
                <Text style={styles.time}>{formatRelativeTime(n.created_at)}</Text>
              </View>
            </Pressable>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.lg },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.background },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { ...typography.caption, flex: 1, color: colors.text, fontWeight: '700' },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  description: { color: colors.textMuted, fontSize: 13 },
  time: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
