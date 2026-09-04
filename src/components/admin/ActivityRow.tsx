import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getNotificationRoute } from '@/lib/notifications/notificationRouting';
import { iconFor, formatRelativeTime } from '@/lib/notifications/notificationDisplay';
import type { AppNotification } from '@/lib/supabase/types';
import { colors, radii, spacing } from '@/constants/theme';

/** One row of the group admin panel's "Actividad reciente" — shared between
 * the inline preview (AdminPanel) and the full paginated list
 * (admin-activity.tsx) so both render identically. */
export function ActivityRow({ notification, isFirst }: { notification: AppNotification; isFirst: boolean }) {
  const handlePress = () => {
    const route = getNotificationRoute(notification);
    if (route) router.push(route);
  };
  return (
    <Pressable onPress={handlePress} style={[styles.row, !isFirst && styles.rowDivider]}>
      <View style={styles.iconWrap}>
        <Ionicons name={iconFor(notification.category)} size={18} color={colors.text} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {notification.title}
        </Text>
        <Text style={styles.description} numberOfLines={2}>
          {notification.body}
        </Text>
        <Text style={styles.time}>{formatRelativeTime(notification.created_at)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { color: colors.text, fontWeight: '700', fontSize: 13 },
  description: { color: colors.textMuted, fontSize: 12 },
  time: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
