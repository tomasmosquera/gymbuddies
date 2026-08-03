import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GROUP_TIMEZONE_OPTIONS } from '@/constants/timezones';
import { colors, radii, spacing } from '@/constants/theme';

/**
 * Vertical list of the curated group timezones — a SegmentedControl doesn't
 * scale to 10 options, so this is a simple radio-style list instead. Governs
 * which calendar day/week a group's check-ins land on and which country's
 * fixed holidays apply (see groups.timezone / TIMEZONE_COUNTRY).
 */
export function TimezonePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.list}>
      {GROUP_TIMEZONE_OPTIONS.map((option) => {
        const isSelected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            onPress={() => onChange(option.value)}
            style={[styles.row, isSelected && styles.rowSelected]}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>{option.label}</Text>
            {isSelected ? <Text style={styles.check}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
  },
  rowSelected: { backgroundColor: colors.primary },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  labelSelected: { color: colors.primaryText },
  check: { color: colors.primaryText, fontWeight: '700' },
});
