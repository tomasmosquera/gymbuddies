import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton } from '@/components/ui/Skeleton';
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

// How many placeholder circles to show while loading — not an attempt to
// match the real count (unknown until the fetch resolves), just enough that
// the row visibly overflows past the screen edge, same as it would with a
// real, longer list.
const SKELETON_COUNT = 7;

/** One pulsing gray circle + label, standing in for a real bubble while the feed is still loading. */
function SkeletonCircle() {
  return (
    <View style={styles.itemColumn}>
      <Skeleton style={[styles.ringWrap, styles.skeletonCircle]} />
      <Skeleton style={styles.skeletonLabel} />
    </View>
  );
}

/**
 * Home's cross-group "what my buddies have been up to" strip — every other
 * member's most recent check-in capture, across every group I'm in, newest
 * first, with MY OWN today's check-in always first (see useGroupsPhotoFeed's
 * `ownItem`) — a gray, unpressable placeholder bubble when I haven't
 * uploaded one yet today, rather than a real bubble or nothing at all, so
 * that slot's position never shifts. While loading, renders a row of
 * pulsing skeleton circles in the exact same spot instead of nothing at all
 * — reserving the space up front is the whole point, so the rest of Home
 * never jumps down once the real bubbles pop in — see useGroupsPhotoFeed's
 * own doc comment for why a photo can be missing here even when the
 * check-in itself still exists.
 */
export function PhotoFeedStrip({
  items,
  ownItem,
  isLoading,
  seenCheckinIds,
  onPressItem,
  onPressOwnEmpty,
  onPressSeeAll,
}: {
  items: PhotoFeedItem[] | null;
  /** My own today's check-in, across any of my groups — null if I haven't uploaded one yet today, in which case the first bubble renders as a gray placeholder that opens check-in (via onPressOwnEmpty) instead of a story. */
  ownItem: PhotoFeedItem | null;
  isLoading: boolean;
  /** Which checkinIds have already been opened — the caller owns this (see Home), so a ring flips to gray the instant a bubble is tapped, not just after a later reload. */
  seenCheckinIds: Set<string>;
  onPressItem: (item: PhotoFeedItem) => void;
  /** Fired when the empty own-story placeholder (no photo uploaded today) is tapped — takes the member straight to check-in instead of doing nothing. */
  onPressOwnEmpty: () => void;
  onPressSeeAll: () => void;
}) {
  if (isLoading) {
    return (
      <View>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Feed de fotos</Text>
          <Text style={styles.headerHint}>Todos tus grupos</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkeletonCircle key={i} />
          ))}
        </ScrollView>
      </View>
    );
  }
  if (!items) return null;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Feed de fotos</Text>
        <Text style={styles.headerHint}>Todos tus grupos</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {ownItem ? (
          <Pressable
            key={ownItem.checkinId}
            onPress={() => onPressItem(ownItem)}
            style={styles.itemColumn}
            accessibilityRole="button"
            accessibilityLabel={`Tu ${ownItem.isVideo ? 'video' : 'foto'} de hoy`}
          >
            <View style={styles.ringWrap}>
              <View style={[styles.ring, { backgroundColor: seenCheckinIds.has(ownItem.checkinId) ? colors.border : colors.primary }]}>
                <View style={styles.ringGap}>
                  <Image source={{ uri: ownItem.thumbnailUrl }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" />
                </View>
              </View>
              {ownItem.isVideo ? (
                <View style={styles.videoBadge}>
                  <Ionicons name="play" size={8} color={colors.text} />
                </View>
              ) : null}
            </View>
            <Text
              style={[styles.itemName, seenCheckinIds.has(ownItem.checkinId) ? styles.itemNameSeen : styles.itemNameUnseen]}
              numberOfLines={1}
            >
              Tú
            </Text>
          </Pressable>
        ) : (
          <Pressable
            key="own-empty"
            onPress={onPressOwnEmpty}
            style={styles.itemColumn}
            accessibilityRole="button"
            accessibilityLabel="Hacer check-in de hoy"
          >
            <View style={styles.ringWrap}>
              <View style={[styles.ring, { backgroundColor: colors.border }]}>
                <View style={styles.ringGap}>
                  <View style={styles.ownEmptyCircle}>
                    <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
                  </View>
                </View>
              </View>
            </View>
            <Text style={[styles.itemName, styles.itemNameSeen]} numberOfLines={1}>
              Tú
            </Text>
          </Pressable>
        )}

        {items.map((item) => {
          const isUnseen = !seenCheckinIds.has(item.checkinId);
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
  skeletonCircle: { borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  skeletonLabel: { width: 28, height: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  // The gray, unpressable placeholder shown in the own-story slot before
  // I've uploaded today's check-in — same footprint as a real photo so the
  // rest of the strip never shifts once one actually appears.
  ownEmptyCircle: {
    width: '100%',
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // 15% larger than 8px (itself 15% larger than the original 7px), per user request.
  groupTagText: { fontSize: 9, fontWeight: '800', color: colors.text },
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
