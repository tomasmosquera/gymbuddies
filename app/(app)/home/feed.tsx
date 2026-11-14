import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { FeedMediaModal } from '@/components/home/FeedMediaModal';
import { useAuth } from '@/hooks/useAuth';
import { useGroupsPhotoFeed, type PhotoFeedItem } from '@/hooks/useGroupsPhotoFeed';
import { markCheckinSeen } from '@/lib/notifications/photoFeedSeenCache';
import { formatZonedDateTime12h } from '@/lib/domain/dateUtils';
import { colors, radii, spacing } from '@/constants/theme';

const FEED_LIMIT = 60;

/** The destination behind Home's "Ver feed" bubble — every other member's check-in capture, across every group I'm in, newest first. See useGroupsPhotoFeed's own doc comment for why an item can silently be missing (dropped expired media, or an old thumbnail-less video), rather than shown broken. */
export default function PhotoFeedScreen() {
  const { session } = useAuth();
  const { items, isLoading } = useGroupsPhotoFeed(session?.user.id ?? null, FEED_LIMIT);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);

  // So the Home strip's rings for whatever check-ins get shown here (the
  // tapped one AND every later auto/manual advance inside the modal) show
  // as seen too, next time Home regains focus — same per-checkin tracking
  // as tapping a bubble directly would do (see PhotoFeedStrip/
  // photoFeedSeenCache).
  const handleViewItem = (viewedItem: PhotoFeedItem) => {
    markCheckinSeen(viewedItem.checkinId).catch(() => {});
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!items || items.length === 0) {
    return (
      <EmptyState
        title="Sin fotos todavía"
        description="Cuando tus compañeros de grupo suban su check-in, sus fotos y videos van a aparecer aquí."
      />
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        {items.map((item, index) => (
          <Pressable key={item.checkinId} onPress={() => setViewingIndex(index)}>
            <Card style={styles.row}>
              <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
              {item.isVideo ? (
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={10} color={colors.text} />
                </View>
              ) : null}
              <View style={styles.rowInfo}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.fullName}
                </Text>
                <Text style={styles.rowGroup} numberOfLines={1}>
                  {item.groupName}
                </Text>
                <Text style={styles.rowTime}>{formatZonedDateTime12h(new Date(item.capturedAt), item.groupTimezone)}</Text>
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>

      <FeedMediaModal
        visible={viewingIndex !== null}
        items={items}
        initialIndex={viewingIndex}
        onClose={() => setViewingIndex(null)}
        onViewItem={handleViewItem}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.background },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, position: 'relative' },
  thumb: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  playBadge: {
    position: 'absolute',
    left: spacing.lg + 38,
    top: 38,
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontWeight: '700', fontSize: 14 },
  rowGroup: { color: colors.primary, fontSize: 12 },
  rowTime: { color: colors.textMuted, fontSize: 12 },
});
