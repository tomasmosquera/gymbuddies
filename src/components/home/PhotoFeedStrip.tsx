import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getPhotoFeedLastSeenAt } from '@/lib/notifications/photoFeedSeenCache';
import type { PhotoFeedItem } from '@/hooks/useGroupsPhotoFeed';
import { colors, radii, spacing } from '@/constants/theme';

function groupTag(groupName: string): string {
  const initials = groupName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return initials.slice(0, 3) || '?';
}

/**
 * Home's cross-group "what my buddies have been up to" strip — every other
 * member's most recent check-in capture, across every group I'm in, newest
 * first. Renders nothing at all while there's genuinely nothing to show
 * (still loading, or no buddy has a live photo right now) rather than an
 * empty row — see useGroupsPhotoFeed's own doc comment for why a photo can
 * be missing here even when the check-in itself still exists.
 */
export function PhotoFeedStrip({
  items,
  isLoading,
  onPressItem,
  onPressSeeAll,
}: {
  items: PhotoFeedItem[] | null;
  isLoading: boolean;
  onPressItem: (item: PhotoFeedItem) => void;
  onPressSeeAll: () => void;
}) {
  // Unseen (green ring) vs already-looked-at (gray ring) — purely a local,
  // per-device "have I opened the feed since this was captured" read, not a
  // synced read receipt. Captured once per mount so the ring a member sees
  // doesn't flip to "seen" the instant they look at the strip itself —
  // only tapping into the full feed (onPressSeeAll's caller) moves the
  // cutoff forward.
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  useEffect(() => {
    getPhotoFeedLastSeenAt().then(setLastSeenAt);
  }, []);

  if (isLoading || !items || items.length === 0) return null;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Feed de fotos</Text>
        <Text style={styles.headerHint}>Todos tus grupos</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => {
          const isUnseen = !lastSeenAt || item.capturedAt > lastSeenAt;
          return (
            <Pressable
              key={item.checkinId}
              onPress={() => onPressItem(item)}
              style={styles.itemColumn}
              accessibilityRole="button"
              accessibilityLabel={`${item.fullName}, grupo ${item.groupName}, ${item.isVideo ? 'video' : 'foto'} de hoy`}
            >
              <View style={styles.ringWrap}>
                <View style={[styles.ring, { backgroundColor: isUnseen ? colors.primary : colors.border }]}>
                  <View style={styles.ringGap}>
                    <Image source={{ uri: item.thumbnailUrl }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" />
                  </View>
                </View>
                <View style={styles.groupTag}>
                  <Text style={styles.groupTagText}>{groupTag(item.groupName)}</Text>
                </View>
                {item.isVideo ? (
                  <View style={styles.videoBadge}>
                    <Ionicons name="play" size={8} color={colors.text} />
                  </View>
                ) : null}
              </View>
              <Text style={[styles.itemName, isUnseen ? styles.itemNameUnseen : styles.itemNameSeen]} numberOfLines={1}>
                {item.fullName.split(' ')[0]}
              </Text>
            </Pressable>
          );
        })}

        <Pressable onPress={onPressSeeAll} style={styles.itemColumn} accessibilityRole="button" accessibilityLabel="Ver el feed completo de fotos">
          <View style={styles.seeAllCircle}>
            <Ionicons name="images-outline" size={22} color={colors.primary} />
          </View>
          <Text style={styles.seeAllText}>Ver feed</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const CIRCLE_SIZE = 58;

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  header: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  headerHint: { fontSize: 11, color: colors.textMuted },
  row: { gap: 14, paddingBottom: spacing.xs, paddingHorizontal: 2 },
  itemColumn: { alignItems: 'center', gap: 6, width: CIRCLE_SIZE + 2 },
  ringWrap: { width: CIRCLE_SIZE, height: CIRCLE_SIZE },
  ring: { width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: radii.pill, padding: 2.5 },
  ringGap: { width: '100%', height: '100%', borderRadius: radii.pill, backgroundColor: colors.background, padding: 2 },
  photo: { width: '100%', height: '100%', borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  groupTag: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.background,
    borderRadius: radii.pill,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  groupTagText: { fontSize: 7, fontWeight: '800', color: colors.text },
  videoBadge: {
    position: 'absolute',
    bottom: -1,
    right: 12,
    width: 15,
    height: 15,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemName: { fontSize: 11, maxWidth: CIRCLE_SIZE + 4 },
  itemNameUnseen: { color: colors.text, fontWeight: '700' },
  itemNameSeen: { color: colors.textMuted, fontWeight: '400' },
  seeAllCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seeAllText: { fontSize: 11, color: colors.primary, fontWeight: '700' },
});
