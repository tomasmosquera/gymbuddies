import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, radii } from '@/constants/theme';
import type { LevelProgress } from '@/lib/domain/xp';

interface AvatarLevelRingProps {
  initials: string;
  level: LevelProgress | null;
  size?: number;
  ringWidth?: number;
}

/**
 * The avatar's border becomes a ring that fills in with progress toward the
 * next level — Perfil's own big avatar, extracted here so any other screen
 * that needs to show a member's level at a glance (e.g. "Tus grupos") uses
 * the exact same visual, just at a different size.
 */
export function AvatarLevelRing({ initials, level, size = 80, ringWidth = 4 }: AvatarLevelRingProps) {
  const radius = (size - ringWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = level?.progress ?? 0;
  const strokeDashoffset = circumference * (1 - progress);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={ringWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.primary}
          strokeWidth={ringWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={[styles.avatarInner, { top: ringWidth + 3, left: ringWidth + 3, right: ringWidth + 3, bottom: ringWidth + 3 }]}>
        <Text style={[styles.avatarText, { fontSize: size * 0.3 }]}>{initials}</Text>
      </View>
      <View style={styles.levelBadge}>
        <Text style={styles.levelBadgeText}>{level?.level ?? 0}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarInner: {
    position: 'absolute',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    minWidth: 26,
    height: 26,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  levelBadgeText: { color: colors.primaryText, fontSize: 12, fontWeight: '700' },
  avatarText: { color: colors.text, fontWeight: '700' },
});
