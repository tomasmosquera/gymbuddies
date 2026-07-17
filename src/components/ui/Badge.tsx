import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/constants/theme';

interface BadgeProps {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

const toneColors: Record<NonNullable<BadgeProps['tone']>, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
  success: { bg: '#123424', fg: colors.success },
  warning: { bg: '#3A2A0E', fg: colors.warning },
  danger: { bg: '#3A1414', fg: colors.danger },
};

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const { bg, fg } = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  label: { fontSize: 12, fontWeight: '700' },
});
