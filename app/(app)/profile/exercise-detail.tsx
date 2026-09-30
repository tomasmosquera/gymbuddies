import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { ComparisonMetric } from '@/components/ui/ComparisonMetric';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { LineChart } from '@/components/stats/LineChart';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useAuth } from '@/hooks/useAuth';
import { useExerciseCatalog } from '@/hooks/useExerciseCatalog';
import { useExerciseGroupLeaderboard } from '@/hooks/useExerciseGroupLeaderboard';
import { useExerciseHistory } from '@/hooks/useExerciseHistory';
import { useExerciseSessionHistory } from '@/hooks/useExerciseSessionHistory';
import {
  annotateHistoryWithRecords,
  chartValuesFor,
  computeExerciseRecords,
  dailyExerciseSeries,
  rankGroupLeaderboard,
  type AnnotatedHistorySet,
  type ExerciseChartMetric,
  type RankedGroupLeaderboardMember,
} from '@/lib/domain/exerciseRecords';
import { kgToUnit, type WeightUnit } from '@/lib/domain/workoutUnits';
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

function formatFullDate(iso: string): string {
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

const PR_BADGES: { key: keyof Pick<AnnotatedHistorySet, 'isWeightPr' | 'isVolumePr' | 'isOneRepMaxPr'>; label: string }[] = [
  { key: 'isWeightPr', label: 'Peso' },
  { key: 'isVolumePr', label: 'Volumen' },
  { key: 'isOneRepMaxPr', label: '1RM' },
];

/** Histórico: every past completed session with this exercise, newest first, each set's weight/reps plus a 🏅 badge for any category (weight/volume/1RM) it set a new all-time best in AT THE TIME — same idea as Hevy's history view. */
function HistoryTab({ exerciseId, unit }: { exerciseId: string; unit: WeightUnit }) {
  const { sessions, isLoading } = useExerciseSessionHistory(exerciseId);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const annotated = annotateHistoryWithRecords(sessions ?? []).reverse();

  if (annotated.length === 0) {
    return <EmptyState title="Sin historial todavía" description="Cuando registres series de este ejercicio, van a aparecer aquí." />;
  }

  return (
    <View style={styles.tabContent}>
      {annotated.map((session) => (
        <Card key={session.sessionId} style={styles.historyCard}>
          <Text style={styles.historyLabel}>{session.label}</Text>
          <Text style={styles.historyDate}>{formatFullDate(session.date)}</Text>

          <View style={styles.setsTableHeader}>
            <Text style={[styles.tableHeaderCell, styles.historySetColumn]}>SET</Text>
            <Text style={[styles.tableHeaderCell, styles.historyValueColumn]}>PESO Y REPS</Text>
          </View>

          {session.sets.map((set) => {
            const badges = PR_BADGES.filter((b) => set[b.key]);
            return (
              <View key={set.id} style={[styles.historySetRow, set.isWarmup && styles.historySetRowWarmup]}>
                <Text style={[styles.historySetNumber, styles.historySetColumn]}>{set.setNumber}</Text>
                <View style={styles.historyValueColumn}>
                  <Text style={styles.historySetValue}>
                    {set.weightKg !== null ? `${kgToUnit(set.weightKg, unit)} ${unit} × ${set.reps}` : `${set.reps} reps`}
                  </Text>
                  {badges.length > 0 ? (
                    <View style={styles.prBadgeRow}>
                      {badges.map((b) => (
                        <View key={b.key} style={styles.prBadge}>
                          <Ionicons name="medal" size={12} color={colors.gold} />
                          <Text style={styles.prBadgeText}>{b.label}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      ))}
    </View>
  );
}

/** Explicación: WorkoutX's own step-by-step instructions for this exercise. The demo image is already shown once, above the tabs — not repeated here. */
function ExplanationTab({ instructions }: { instructions: string[] }) {
  if (instructions.length === 0) {
    return <EmptyState title="Sin instrucciones todavía" description="Todavía no tenemos el paso a paso de este ejercicio." />;
  }
  return (
    <View style={styles.tabContent}>
      {instructions.map((step, i) => (
        <View key={i} style={styles.instructionRow}>
          <Text style={styles.instructionNumber}>{i + 1}.</Text>
          <Text style={styles.instructionText}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

// ComparisonBar/ComparisonMetric moved to src/components/ui/ComparisonMetric.tsx
// so comparativas.tsx's whole-catalog head-to-head can render the exact same
// "you vs them" bars without duplicating them.

/** Grupo: this exercise's leaderboard across the active group (switchable metric, same pills as Resumen), plus a "you vs them" comparison when a member is tapped. */
function GroupTab({ exerciseId, unit, currentUserId }: { exerciseId: string; unit: WeightUnit; currentUserId: string | null }) {
  const { group } = useActiveGroup();
  const { members, isLoading } = useExerciseGroupLeaderboard(exerciseId, group?.id ?? null);
  const [metric, setMetric] = useState<ExerciseChartMetric>('heaviestWeight');
  const [comparedUserId, setComparedUserId] = useState<string | null>(null);

  if (!group) {
    return <EmptyState title="Sin grupo activo" description="Únete a un grupo para comparar tu progreso con los demás." />;
  }
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const ranked = rankGroupLeaderboard(members ?? [], metric);
  const you = ranked.find((m) => m.userId === currentUserId) ?? null;
  const compared = ranked.find((m) => m.userId === comparedUserId) ?? null;
  const metricLabel = METRIC_OPTIONS.find((m) => m.key === metric)!.label;

  return (
    <View style={styles.tabContent}>
      <SegmentedControl options={METRIC_OPTIONS} value={metric} onChange={setMetric} />

      <Card style={styles.leaderboardCard}>
        <Text style={styles.recordsTitle}>Leaderboard del Grupo · {metricLabel}</Text>
        {ranked.map((m: RankedGroupLeaderboardMember) => {
          const isYou = m.userId === currentUserId;
          const value = m[metric === 'heaviestWeight' ? 'heaviestWeightKg' : metric === 'oneRepMax' ? 'best1RmKg' : 'bestSetVolumeKg'];
          return (
            <Pressable
              key={m.userId}
              disabled={isYou}
              onPress={() => setComparedUserId(m.userId)}
              style={[styles.leaderboardRow, comparedUserId === m.userId && styles.leaderboardRowActive]}
            >
              <Text style={styles.leaderboardRank}>{m.rank}</Text>
              <Text style={[styles.leaderboardName, isYou && styles.leaderboardNameYou]} numberOfLines={1}>
                {isYou ? 'Tú' : m.fullName}
              </Text>
              <Text style={styles.leaderboardValue}>{value !== null ? `${kgToUnit(value, unit)} ${unit}` : '—'}</Text>
            </Pressable>
          );
        })}
      </Card>

      {compared && you ? (
        <Card style={styles.comparisonCard}>
          <View style={styles.comparisonHeader}>
            <Text style={styles.recordsTitle}>Tú vs {compared.fullName}</Text>
            {you.rank !== compared.rank ? (
              <View style={[styles.strongerBadge, you.rank < compared.rank ? styles.strongerBadgeYes : styles.strongerBadgeNo]}>
                <Text style={styles.strongerBadgeText}>{you.rank < compared.rank ? 'MÁS FUERTE' : 'MENOS FUERTE'}</Text>
              </View>
            ) : null}
          </View>
          <ComparisonMetric label="One Rep Max" youKg={you.best1RmKg} otherKg={compared.best1RmKg} otherName={compared.fullName} unit={unit} />
          <ComparisonMetric
            label="Peso Máximo"
            youKg={you.heaviestWeightKg}
            otherKg={compared.heaviestWeightKg}
            otherName={compared.fullName}
            unit={unit}
          />
          <ComparisonMetric
            label="Mejor Set (Volumen)"
            youKg={you.bestSetVolumeKg}
            otherKg={compared.bestSetVolumeKg}
            otherName={compared.fullName}
            unit={unit}
          />
        </Card>
      ) : (
        <Text style={styles.comparisonHint}>Toca a alguien del grupo para comparar tu progreso con el suyo.</Text>
      )}
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
  const { profile, session: authSession } = useAuth();
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
      {tab === 'historico' ? <HistoryTab exerciseId={exercise.id} unit={unit} /> : null}
      {tab === 'grupo' ? <GroupTab exerciseId={exercise.id} unit={unit} currentUserId={authSession?.user.id ?? null} /> : null}
      {tab === 'explicacion' ? <ExplanationTab instructions={exercise.instructions} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  imageWrap: {
    aspectRatio: 1.4,
    // White, not the dark theme's surfaceAlt — the WorkoutX GIFs are drawn
    // on a white background, so a dark card showed a visible white box
    // around the animation instead of it blending into the card.
    backgroundColor: '#FFFFFF',
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
  setsTableHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  tableHeaderCell: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  historyCard: { gap: 2 },
  historyLabel: { ...typography.heading, fontSize: 15, color: colors.text },
  historyDate: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs },
  historySetColumn: { width: 32 },
  historyValueColumn: { flex: 1 },
  historySetRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historySetRowWarmup: { opacity: 0.55 },
  historySetNumber: { color: colors.text, fontWeight: '700', fontSize: 14 },
  historySetValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  prBadgeRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(245, 197, 66, 0.12)',
  },
  prBadgeText: { color: colors.gold, fontSize: 10, fontWeight: '700' },
  instructionRow: { flexDirection: 'row', gap: spacing.sm },
  instructionNumber: { color: colors.primary, fontWeight: '700', fontSize: 14, width: 20 },
  instructionText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  leaderboardCard: { gap: 2 },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderRadius: radii.sm,
  },
  leaderboardRowActive: { backgroundColor: colors.surfaceAlt },
  leaderboardRank: { width: 24, color: colors.textMuted, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  leaderboardName: { flex: 1, color: colors.text, fontSize: 14 },
  leaderboardNameYou: { fontWeight: '700', color: colors.primary },
  leaderboardValue: { color: colors.text, fontWeight: '700', fontSize: 14 },
  comparisonHint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md },
  comparisonCard: { gap: spacing.md },
  comparisonHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  strongerBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill },
  strongerBadgeYes: { backgroundColor: 'rgba(61, 220, 151, 0.15)' },
  strongerBadgeNo: { backgroundColor: 'rgba(255, 107, 107, 0.15)' },
  strongerBadgeText: { fontSize: 10, fontWeight: '800', color: colors.text },
});
