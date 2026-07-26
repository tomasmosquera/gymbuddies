import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '@/constants/theme';

export interface BarListItem {
  label: string;
  /** 0-1, how full the bar should render. */
  ratio: number;
  valueLabel: string;
  highlight?: boolean;
}

/** A minimal horizontal bar list — used for weekday and check-in-hour distributions. */
export function BarList({ items, color }: { items: BarListItem[]; color?: string }) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item.label} style={styles.row}>
          <Text style={[styles.label, item.highlight && styles.labelHighlight]} numberOfLines={1}>
            {item.label}
          </Text>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(Math.max(0, Math.min(1, item.ratio)) * 100)}%` },
                { backgroundColor: item.highlight ? colors.primary : (color ?? colors.textMuted) },
              ]}
            />
          </View>
          <Text style={styles.value}>{item.valueLabel}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { width: 64, color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  labelHighlight: { color: colors.text },
  track: {
    flex: 1,
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radii.pill },
  value: { width: 40, textAlign: 'right', color: colors.textMuted, fontSize: 12, fontWeight: '600' },
});
