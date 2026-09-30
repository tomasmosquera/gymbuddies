import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { kgToUnit, type WeightUnit } from '@/lib/domain/workoutUnits';
import { colors, radii, spacing } from '@/constants/theme';

/** One "Tú" vs "them" bar for a single metric — extracted from exercise-detail.tsx's Grupo tab so comparativas.tsx (whole-catalog head-to-head) can render the exact same look without duplicating it. */
function ComparisonBar({ label, value, pct, isYou }: { label: string; value: string; pct: number; isYou: boolean }) {
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }, isYou ? styles.barFillYou : styles.barFillOther]} />
      </View>
      <Text style={styles.barValue}>{value}</Text>
    </View>
  );
}

/** One metric's "you vs them" comparison — two bars scaled to whichever value is larger, plus a % delta. Weight-in-kg-flavored (exercise records are always weights) — formats through `unit` like every other displayed weight. */
export function ComparisonMetric({
  label,
  youKg,
  otherKg,
  otherName,
  unit,
}: {
  label: string;
  youKg: number | null;
  otherKg: number | null;
  otherName: string;
  unit: WeightUnit;
}) {
  const maxKg = Math.max(youKg ?? 0, otherKg ?? 0, 1);
  const deltaPct = youKg !== null && otherKg !== null && otherKg > 0 ? Math.round(((youKg - otherKg) / otherKg) * 100) : null;
  return (
    <View style={styles.metric}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{label}</Text>
        {deltaPct !== null ? (
          <View style={styles.deltaRow}>
            <Ionicons name={deltaPct >= 0 ? 'arrow-up' : 'arrow-down'} size={12} color={deltaPct >= 0 ? colors.primary : colors.danger} />
            <Text style={[styles.deltaText, { color: deltaPct >= 0 ? colors.primary : colors.danger }]}>{Math.abs(deltaPct)}%</Text>
          </View>
        ) : null}
      </View>
      <ComparisonBar label="Tú" value={youKg !== null ? `${kgToUnit(youKg, unit)} ${unit}` : '—'} pct={youKg !== null ? (youKg / maxKg) * 100 : 0} isYou />
      <ComparisonBar
        label={otherName}
        value={otherKg !== null ? `${kgToUnit(otherKg, unit)} ${unit}` : '—'}
        pct={otherKg !== null ? (otherKg / maxKg) * 100 : 0}
        isYou={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  metric: { gap: 4 },
  metricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricLabel: { color: colors.text, fontWeight: '700', fontSize: 14 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deltaText: { fontSize: 12, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  barLabel: { width: 60, color: colors.textMuted, fontSize: 12 },
  barTrack: { flex: 1, height: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radii.pill },
  barFillYou: { backgroundColor: colors.primary },
  barFillOther: { backgroundColor: colors.textMuted },
  barValue: { width: 64, textAlign: 'right', color: colors.text, fontSize: 12, fontWeight: '600' },
});
