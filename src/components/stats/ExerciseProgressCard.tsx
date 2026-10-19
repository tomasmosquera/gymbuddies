import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { LineChart } from '@/components/stats/LineChart';
import { useExerciseHistory } from '@/hooks/useExerciseHistory';
import { chartValuesFor, computeExerciseRecords, dailyExerciseSeries, type ExerciseChartMetric } from '@/lib/domain/exerciseRecords';
import { kgToUnit, type WeightUnit } from '@/lib/domain/workoutUnits';
import { colors, spacing, typography } from '@/constants/theme';

const METRIC_OPTIONS: { key: ExerciseChartMetric; label: string }[] = [
  { key: 'heaviestWeight', label: 'Máximo Peso' },
  { key: 'oneRepMax', label: 'One Rep Max' },
  { key: 'bestSetVolume', label: 'Mejor Vol. Set' },
];

const RECORD_LABELS: Record<ExerciseChartMetric | 'sessionVolume', string> = {
  heaviestWeight: 'Peso Máximo',
  oneRepMax: 'Mejor 1RM',
  bestSetVolume: 'Mejor Volumen de un Set',
  sessionVolume: 'Mejor Volumen de Sesión',
};

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

/**
 * "Resumen" — a progress chart switchable between 3 metrics, plus all-time Personal Records.
 * Originally exercise-detail.tsx's own Resumen tab, factored out so exercise-stats.tsx can show
 * the exact same thing for whichever exercise its own picker selects, instead of duplicating it.
 */
export function ExerciseProgressCard({ exerciseId, unit }: { exerciseId: string; unit: WeightUnit }) {
  const { entries, isLoading } = useExerciseHistory(exerciseId);
  const [metric, setMetric] = useState<ExerciseChartMetric>('heaviestWeight');

  const series = useMemo(() => dailyExerciseSeries(entries ?? []), [entries]);
  const records = useMemo(() => computeExerciseRecords(entries ?? []), [entries]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const chartSeries = [
    {
      label: METRIC_OPTIONS.find((m) => m.key === metric)!.label,
      color: colors.primary,
      values: chartValuesFor(series, metric).map((v) => (v === null ? null : kgToUnit(v, unit))),
    },
  ];

  const recordRows: { label: string; value: number | null }[] = [
    { label: RECORD_LABELS.heaviestWeight, value: records.heaviestWeightKg },
    { label: RECORD_LABELS.oneRepMax, value: records.best1RmKg },
    { label: RECORD_LABELS.bestSetVolume, value: records.bestSetVolumeKg },
    { label: RECORD_LABELS.sessionVolume, value: records.bestSessionVolumeKg },
  ];

  return (
    <View style={styles.tabContent}>
      <SegmentedControl options={METRIC_OPTIONS} value={metric} onChange={setMetric} />

      <Card>
        <LineChart xLabels={series.map((p) => formatShortDate(p.date))} series={chartSeries} unit={` ${unit}`} visiblePoints={8} />
      </Card>

      <Card style={styles.recordsCard}>
        <View style={styles.recordsHeader}>
          <Ionicons name="medal" size={18} color={colors.gold} />
          <Text style={styles.recordsTitle}>Récords Personales</Text>
        </View>
        {recordRows.map((row) => (
          <View key={row.label} style={styles.recordRow}>
            <Text style={styles.recordLabel}>{row.label}</Text>
            <Text style={styles.recordValue}>{row.value !== null ? `${kgToUnit(row.value, unit)} ${unit}` : '—'}</Text>
          </View>
        ))}

        {records.setRecords.length > 0 ? (
          <View style={styles.setRecordsSection}>
            <View style={styles.setRecordsHeaderRow}>
              <Text style={styles.setRecordsHeaderCell}>Reps</Text>
              <Text style={styles.setRecordsHeaderCell}>Mejor Peso</Text>
            </View>
            {records.setRecords.map((r) => (
              <View key={r.reps} style={styles.recordRow}>
                <Text style={styles.recordLabel}>{r.reps}</Text>
                <Text style={styles.recordValue}>
                  {kgToUnit(r.weightKg, unit)} {unit}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.lg },
  tabContent: { gap: spacing.md },
  recordsCard: { gap: spacing.xs },
  recordsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  recordsTitle: { ...typography.heading, fontSize: 15, color: colors.text },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recordLabel: { color: colors.text, fontSize: 14 },
  recordValue: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  setRecordsSection: { marginTop: spacing.sm },
  setRecordsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  setRecordsHeaderCell: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
});
