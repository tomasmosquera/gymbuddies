import { StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '@/constants/theme';
import { useIsLeagueChampion } from '@/hooks/useLeagueChampions';
import { CrownIcon } from '@/components/ui/CrownIcon';

interface AvatarWithLevelProps {
  initials: string;
  /** Omit to render a plain avatar with no level bubble (e.g. level data still loading). */
  level?: number;
  size?: number;
  /** Should match whatever surface this avatar sits on, so the badge's cutout border blends in. */
  borderColor?: string;
  /** The avatar circle's own fill — defaults to surfaceAlt (the look everywhere it's used today: Leaderboard, Dashboard, ...). Pass the exact background of whatever it sits on to make the circle itself disappear, leaving only the initials + level badge — e.g. a hero card whose own background already IS surfaceAlt. */
  backgroundColor?: string;
  /** The member this avatar belongs to. When they won the previous Liga cycle (1st place, ties included) a crown replaces the initials — omit to always show initials. */
  userId?: string;
}

/** A small initials avatar with the member's XP level overlapping its bottom-right corner (see useGroupBadges). */
export function AvatarWithLevel({
  initials,
  level,
  size = 32,
  borderColor = colors.surface,
  backgroundColor = colors.surfaceAlt,
  userId,
}: AvatarWithLevelProps) {
  const isChampion = useIsLeagueChampion(userId);
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor }]}>
        {isChampion ? <CrownIcon size={Math.round(size * 0.62)} /> : <Text style={styles.avatarText}>{initials}</Text>}
      </View>
      {level !== undefined ? (
        <View style={[styles.levelBadge, { borderColor }]}>
          <Text style={styles.levelBadgeText}>{level}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontWeight: '700' },
  levelBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  levelBadgeText: { color: colors.primaryText, fontSize: 8, fontWeight: '700' },
});
