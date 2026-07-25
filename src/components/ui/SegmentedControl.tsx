import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/constants/theme';

interface SegmentOption<T extends string> {
  key: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 'lg' makes the control taller/bolder — for a primary choice that should read as more important than a secondary filter next to it. */
  size?: 'md' | 'lg';
}

export function SegmentedControl<T extends string>({ options, value, onChange, size = 'md' }: SegmentedControlProps<T>) {
  const isLarge = size === 'lg';
  return (
    <View style={styles.container}>
      {options.map((option) => {
        const isActive = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            onPress={() => onChange(option.key)}
            style={[styles.segment, isLarge && styles.segmentLarge, isActive && styles.segmentActive]}
          >
            <Text style={[styles.label, isLarge && styles.labelLarge, isActive && styles.labelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLarge: { paddingVertical: spacing.md },
  segmentActive: { backgroundColor: colors.primary },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  labelLarge: { fontSize: 15, fontWeight: '700' },
  labelActive: { color: colors.primaryText },
});
