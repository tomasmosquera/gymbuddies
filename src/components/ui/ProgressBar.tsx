import { StyleSheet, View } from 'react-native';
import { colors, radii } from '@/constants/theme';

interface ProgressBarProps {
  progress: number; // 0..1
  color?: string;
}

export function ProgressBar({ progress, color = colors.primary }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
  },
});
