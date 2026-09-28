import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { LineChart } from '@/components/stats/LineChart';
import { useAuth } from '@/hooks/useAuth';
import { useExerciseCatalog } from '@/hooks/useExerciseCatalog';
import { useExerciseHistory } from '@/hooks/useExerciseHistory';
import { chartValuesFor, computeExerciseRecords, dailyExerciseSeries, type ExerciseChartMetric } from '@/lib/domain/exerciseRecords';
import { kgToUnit } from '@/lib/domain/workoutUnits';
import { MUSCLE_GROUP_LABELS } from '@/constants/muscleGroups';
import { colors, radii, spacing, typography } from '@/constants/theme';

type DetailTab = 'resumen' | 'historico' | 'grupo' | 'explicacion';

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

function ComingSoon({ label }: { label: string }) {
  return (
    <View style={styles.comingSoon}>
      <Ionicons name="time-outline" size={28} color={colors.textMuted} />
      <Text style={styles.comingSoonText}>{label} — próximamente.</Text>
    </View>
  );
}

/** Resumen: demo image, a progress chart switchable between 3 metrics, and all-time Personal Records — same shape as the Hevy reference screenshot. */
function SummaryTab({ exerciseId, unit }: { exerciseId: string; unit: 'kg' | 'lbs' }) {
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

export default function ExerciseDetailScreen() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const { profile } = useAuth();
  const { exercises, isLoading } = useExerciseCatalog();
  const [tab, setTab] = useState<DetailTab>('resumen');
  const unit = profile?.weight_unit ?? 'kg';
  const exercise = exercises.find((e) => e.id === exerciseId) ?? null;

  if (isLoading || !exercise) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.imageWrap}>
        {exercise.gif_url ? (
          <Image source={{ uri: exercise.gif_url }} style={styles.image} contentFit="contain" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="barbell-outline" size={40} color={colors.textMuted} />
            <Text style={styles.imagePlaceholderText}>Sin imagen todavía</Text>
          </View>
        )}
      </View>

      <Text style={styles.name}>{exercise.name}</Text>
      <Text style={styles.muscleLine}>
        Primario: {MUSCLE_GROUP_LABELS[exercise.muscle_group]}
        {exercise.secondary_muscles.length > 0 ? `  ·  Secundario: ${exercise.secondary_muscles.join(', ')}` : ''}
      </Text>

      <SegmentedControl
        options={[
          { key: 'resumen', label: 'Resumen' },
          { key: 'historico', label: 'Histórico' },
          { key: 'grupo', label: 'Grupo' },
          { key: 'explicacion', label: 'Explicación' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'resumen' ? <SummaryTab exerciseId={exercise.id} unit={unit} /> : null}
      {tab === 'historico' ? <ComingSoon label="Histórico" /> : null}
      {tab === 'grupo' ? <ComingSoon label="Comparación con el grupo" /> : null}
      {tab === 'explicacion' ? <ComingSoon label="Explicación" /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  imageWrap: {
    aspectRatio: 1.4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  imagePlaceholderText: { color: colors.textMuted, fontSize: 13 },
  name: { ...typography.heading, fontSize: 20, color: colors.text },
  muscleLine: { color: colors.textMuted, fontSize: 13 },
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
  comingSoon: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  comingSoonText: { color: colors.textMuted, fontSize: 13 },
});
