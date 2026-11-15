import { StyleSheet, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { PhotoFeedStrip } from '@/components/home/PhotoFeedStrip';
import { colors, radii, spacing } from '@/constants/theme';

const DAY_COUNT = 7;
const LEADERBOARD_ROW_COUNT = 4;

/**
 * Stands in for the whole Home screen while its gating data (group,
 * membership) is still loading — mirrors the real layout's cards/sections
 * one-for-one (same container padding/gap as Home's own `styles.container`)
 * so nothing shifts once the real content swaps in, same reasoning as
 * PhotoFeedStrip's own skeleton row.
 */
export function HomeSkeleton() {
  return (
    <View style={styles.container}>
      <PhotoFeedStrip
        items={null}
        ownItem={null}
        isLoading
        seenCheckinIds={EMPTY_SEEN_SET}
        onPressItem={NOOP}
        onPressOwnEmpty={NOOP}
        onPressSeeAll={NOOP}
      />

      <Skeleton style={{ height: 28, width: '55%', borderRadius: radii.sm }} />
      <Skeleton style={{ height: 14, width: '35%', borderRadius: radii.sm, marginTop: spacing.xs }} />

      <Card style={{ gap: spacing.sm }}>
        <Skeleton style={{ height: 14, width: '30%' }} />
        <Skeleton style={{ height: 28, width: '50%' }} />
        <Skeleton style={{ height: 12, width: '80%' }} />
      </Card>

      <Card>
        <Skeleton style={{ height: 20, width: '40%', alignSelf: 'center' }} />
        <Skeleton style={{ height: 8, width: '100%', borderRadius: radii.pill, marginTop: spacing.md }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
          {Array.from({ length: DAY_COUNT }).map((_, i) => (
            <Skeleton key={i} style={{ width: 32, height: 32, borderRadius: radii.pill }} />
          ))}
        </View>
      </Card>

      <Skeleton style={{ height: 52, width: '100%', borderRadius: radii.md }} />

      <Card style={{ gap: spacing.sm }}>
        <Skeleton style={{ height: 18, width: '45%' }} />
        {Array.from({ length: LEADERBOARD_ROW_COUNT }).map((_, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Skeleton style={{ width: 28, height: 28, borderRadius: radii.pill }} />
            <Skeleton style={{ height: 14, flex: 1 }} />
            <Skeleton style={{ height: 14, width: 40 }} />
          </View>
        ))}
      </Card>
    </View>
  );
}

const EMPTY_SEEN_SET = new Set<string>();
const NOOP = () => {};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xs,
    gap: spacing.md,
    backgroundColor: colors.background,
    flex: 1,
  },
});
