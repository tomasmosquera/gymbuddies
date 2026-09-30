import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { ComparisonMetric } from '@/components/ui/ComparisonMetric';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useAuth } from '@/hooks/useAuth';
import { useGroupExerciseHistory } from '@/hooks/useGroupExerciseHistory';
import {
  buildGroupRecordsTable,
  buildHeadToHeadTable,
  type ExerciseRecordHolder,
  type GroupExerciseHistory,
  type HeadToHeadRow,
} from '@/lib/domain/groupExerciseComparison';
import type { ExerciseChartMetric } from '@/lib/domain/exerciseRecords';
import {
  computeMuscleAbsoluteRadar,
  computeMuscleBucketCounts,
  computeMuscleGroupPercentileRadar,
  computeMuscleShareRadar,
  MUSCLE_BUCKET_LABELS,
  MUSCLE_BUCKET_ORDER,
  type MuscleBucket,
  type MuscleRadarScaleMode,
} from '@/lib/domain/muscleDistribution';
import { kgToUnit, type WeightUnit } from '@/lib/domain/workoutUnits';
import { RadarChart } from '@/components/stats/RadarChart';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_ORDER } from '@/constants/muscleGroups';
import { colors, radii, spacing, typography } from '@/constants/theme';

type MainTab = 'records' | 'comparar';

const METRIC_OPTIONS: { key: ExerciseChartMetric; label: string }[] = [
  { key: 'heaviestWeight', label: 'Máximo Peso' },
  { key: 'oneRepMax', label: 'One Rep Max' },
  { key: 'bestSetVolume', label: 'Mejor Vol. Set' },
];

/** Récords: one row per exercise the group's ever logged, whoever currently holds the group's best value for the selected metric — the "who's the strongest at X" table, without opening each exercise one by one. The metric pills are the list's own ListHeaderComponent (not a fixed header outside it) so they scroll away with everything else — a fixed header ate space that should go to seeing the actual list. */
function RecordsTab({
  history,
  roster,
  metric,
  setMetric,
  unit,
  myUserId,
}: {
  history: GroupExerciseHistory[];
  roster: { userId: string; fullName: string }[];
  metric: ExerciseChartMetric;
  setMetric: (metric: ExerciseChartMetric) => void;
  unit: WeightUnit;
  myUserId: string | null;
}) {
  const table = useMemo(() => buildGroupRecordsTable(history, roster, metric), [history, roster, metric]);

  const sections = useMemo(() => {
    const byGroup = new Map<string, ExerciseRecordHolder[]>();
    for (const row of table) {
      const list = byGroup.get(row.muscleGroup) ?? [];
      list.push(row);
      byGroup.set(row.muscleGroup, list);
    }
    return MUSCLE_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ title: MUSCLE_GROUP_LABELS[g], data: byGroup.get(g)! }));
  }, [table]);

  if (table.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay récords"
        description="Cuando el grupo empiece a registrar entrenos, acá va a aparecer quién tiene el récord de cada ejercicio."
      />
    );
  }

  return (
    <SectionList
      style={styles.flex}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <View style={styles.metricPillsWrap}>
          <SegmentedControl options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
        </View>
      }
      sections={sections}
      keyExtractor={(item) => item.exerciseId}
      renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
      renderItem={({ item }) => {
        const isYou = item.holder!.userId === myUserId;
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/profile/exercise-detail', params: { exerciseId: item.exerciseId } })}
            style={styles.recordRow}
          >
            <Text style={styles.recordExercise} numberOfLines={1}>
              {item.exerciseName}
            </Text>
            <View style={styles.recordHolderWrap}>
              <Text style={[styles.recordHolder, isYou && styles.recordHolderYou]} numberOfLines={1}>
                {isYou ? 'Tú' : item.holder!.fullName}
              </Text>
              <Text style={styles.recordValue}>
                {kgToUnit(item.valueKg!, unit)} {unit}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

/** Comparar: the same "Tú vs [compañero]" exercise-detail.tsx already has per exercise, generalized across every exercise the group's logged at once — pick someone, see every exercise either of you has done side by side. Everything (muscle radar, metric pills, teammate picker, per-exercise list) lives inside this one ScrollView now — it used to sit under a fixed, non-scrolling header, which ate the screen once the radar made that header tall enough that the list below barely fit. */
function CompareTab({
  history,
  roster,
  metric,
  setMetric,
  unit,
  myUserId,
}: {
  history: GroupExerciseHistory[];
  roster: { userId: string; fullName: string }[];
  metric: ExerciseChartMetric;
  setMetric: (metric: ExerciseChartMetric) => void;
  unit: WeightUnit;
  myUserId: string | null;
}) {
  const teammates = roster.filter((m) => m.userId !== myUserId);
  const [comparedUserId, setComparedUserId] = useState<string | null>(teammates[0]?.userId ?? null);
  const compared = teammates.find((m) => m.userId === comparedUserId) ?? null;

  const table: HeadToHeadRow[] = useMemo(
    () => (myUserId && comparedUserId ? buildHeadToHeadTable(history, myUserId, comparedUserId, metric) : []),
    [history, myUserId, comparedUserId, metric]
  );

  if (teammates.length === 0) {
    return <EmptyState title="Sin compañeros todavía" description="Cuando se unan más miembros al grupo, vas a poder compararte con ellos acá." />;
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.compareContent}>
      <MuscleRadarSection history={history} roster={roster} myUserId={myUserId} comparedUserId={comparedUserId} comparedName={compared?.fullName ?? null} />
      <SegmentedControl options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {teammates.map((m) => (
          <Pressable key={m.userId} onPress={() => setComparedUserId(m.userId)} style={[styles.chip, comparedUserId === m.userId && styles.chipActive]}>
            <Text style={[styles.chipText, comparedUserId === m.userId && styles.chipTextActive]} numberOfLines={1}>
              {m.fullName}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {compared && table.length > 0 ? (
        table.map((row) => (
          <Card key={row.exerciseId} style={styles.compareCard}>
            <Pressable onPress={() => router.push({ pathname: '/profile/exercise-detail', params: { exerciseId: row.exerciseId } })}>
              <Text style={styles.compareExerciseName}>{row.exerciseName}</Text>
            </Pressable>
            <ComparisonMetric
              label={METRIC_OPTIONS.find((m) => m.key === metric)!.label}
              youKg={row.meKg}
              otherKg={row.themKg}
              otherName={compared.fullName}
              unit={unit}
            />
          </Card>
        ))
      ) : (
        <Text style={styles.compareHint}>
          {compared ? 'Ninguno de los dos ha registrado ejercicios todavía.' : 'Elige a alguien del grupo para comparar.'}
        </Text>
      )}
    </ScrollView>
  );
}

const ZERO_MUSCLE_COUNTS: Record<MuscleBucket, number> = MUSCLE_BUCKET_ORDER.reduce(
  (acc, b) => ({ ...acc, [b]: 0 }),
  {} as Record<MuscleBucket, number>
);

const SCALE_MODE_OPTIONS: { key: MuscleRadarScaleMode; label: string }[] = [
  { key: 'ownShare', label: '% propio' },
  { key: 'groupPercentile', label: 'Vs. grupo' },
  { key: 'absolute', label: 'Absoluta' },
];

/** Every roster member's own muscle bucket counts, keyed by user_id — computeMuscleGroupPercentileRadar's "everyone else" pool for the Vs. grupo scale mode. */
function bucketCountsByUser(history: GroupExerciseHistory[], roster: { userId: string }[]): Map<string, Record<MuscleBucket, number>> {
  const result = new Map<string, Record<MuscleBucket, number>>();
  for (const m of roster) {
    const entries = history.map((ex) => ({
      muscleGroup: ex.muscleGroup,
      secondaryMuscles: ex.secondaryMuscles,
      sets: ex.entriesByUser.get(m.userId)?.flatMap((e) => e.sets) ?? [],
    }));
    result.set(m.userId, computeMuscleBucketCounts(entries));
  }
  return result;
}

/**
 * "Qué tanto ejercitan las distintas partes del cuerpo" — Tú vs el compañero
 * elegido, un eje por grupo muscular (ver muscleDistribution.ts), primary y
 * secondary combinados. Sits above the metric pills (Comparar tab) since
 * it's independent of which weight metric is selected — this is about
 * training FREQUENCY (real set counts), not how heavy anything was. Three
 * switchable scale modes (own pill row, independent of the tab/metric
 * pills) since "who trains X more, head to head" (the original, one-mode
 * version) made whoever trains more of a muscle always hit the edge, which
 * didn't read well — see muscleDistribution.ts for what each mode means.
 */
function MuscleRadarSection({
  history,
  roster,
  myUserId,
  comparedUserId,
  comparedName,
}: {
  history: GroupExerciseHistory[];
  roster: { userId: string; fullName: string }[];
  myUserId: string | null;
  comparedUserId: string | null;
  comparedName: string | null;
}) {
  const [scaleMode, setScaleMode] = useState<MuscleRadarScaleMode>('ownShare');

  if (!myUserId || !comparedUserId || !comparedName) return null;

  const countsByUser = bucketCountsByUser(history, roster);
  const myCounts = countsByUser.get(myUserId) ?? ZERO_MUSCLE_COUNTS;
  const theirCounts = countsByUser.get(comparedUserId) ?? ZERO_MUSCLE_COUNTS;

  if (Object.values(myCounts).every((v) => v === 0) && Object.values(theirCounts).every((v) => v === 0)) {
    return <Text style={styles.compareHint}>Todavía nadie ha registrado ejercicios para ver la distribución muscular.</Text>;
  }

  let mineValues: number[];
  let theirValues: number[];
  if (scaleMode === 'ownShare') {
    mineValues = computeMuscleShareRadar(myCounts);
    theirValues = computeMuscleShareRadar(theirCounts);
  } else if (scaleMode === 'groupPercentile') {
    const others = Array.from(countsByUser.entries()).filter(([id]) => id !== myUserId).map(([, c]) => c);
    const othersForThem = Array.from(countsByUser.entries()).filter(([id]) => id !== comparedUserId).map(([, c]) => c);
    mineValues = computeMuscleGroupPercentileRadar(myCounts, others);
    theirValues = computeMuscleGroupPercentileRadar(theirCounts, othersForThem);
  } else {
    const sharedMax = Math.max(...MUSCLE_BUCKET_ORDER.map((b) => Math.max(myCounts[b], theirCounts[b])));
    mineValues = computeMuscleAbsoluteRadar(myCounts, sharedMax);
    theirValues = computeMuscleAbsoluteRadar(theirCounts, sharedMax);
  }

  return (
    <Card style={styles.radarCard}>
      <Text style={styles.radarTitle}>Distribución muscular</Text>
      <SegmentedControl options={SCALE_MODE_OPTIONS} value={scaleMode} onChange={setScaleMode} />
      <RadarChart
        axes={MUSCLE_BUCKET_ORDER.map((b) => MUSCLE_BUCKET_LABELS[b])}
        series={[
          { label: 'Tú', color: colors.primary, values: mineValues },
          { label: comparedName, color: colors.warning, values: theirValues },
        ]}
        size={260}
      />
    </Card>
  );
}

/**
 * Comparativas (Perfil → Rutinas → debajo de Historial de entrenos) — lets
 * the group compare performance without opening each exercise one by one:
 * "Récords" (idea 1, who holds the group's best value per exercise) and
 * "Comparar" (idea 3, the same head-to-head exercise-detail.tsx's Grupo tab
 * already does for one exercise, generalized across every exercise at once).
 */
export default function ComparativasScreen() {
  const { session, profile } = useAuth();
  const { group } = useActiveGroup();
  const { roster, history, isLoading } = useGroupExerciseHistory(group?.id ?? null);
  const [tab, setTab] = useState<MainTab>('records');
  const [metric, setMetric] = useState<ExerciseChartMetric>('heaviestWeight');
  const myUserId = session?.user.id ?? null;
  const unit = profile?.weight_unit ?? 'kg';

  if (!group) {
    return (
      <View style={styles.center}>
        <EmptyState title="Sin grupo activo" description="Únete a un grupo para comparar tu progreso con los demás." />
      </View>
    );
  }
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      {/* Just the tab switcher stays fixed — everything else (metric pills,
          muscle radar, lists) now scrolls away with the content, so it
          doesn't eat screen space a tall radar needs. */}
      <View style={styles.header}>
        <SegmentedControl
          options={[
            { key: 'records', label: 'Récords' },
            { key: 'comparar', label: 'Comparar' },
          ]}
          value={tab}
          onChange={setTab}
          size="lg"
        />
      </View>

      {tab === 'records' ? (
        <RecordsTab history={history} roster={roster} metric={metric} setMetric={setMetric} unit={unit} myUserId={myUserId} />
      ) : (
        <CompareTab history={history} roster={roster} metric={metric} setMetric={setMetric} unit={unit} myUserId={myUserId} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.lg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.background },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  metricPillsWrap: { paddingBottom: spacing.sm },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    backgroundColor: colors.background,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recordExercise: { flex: 1, color: colors.text, fontSize: 14 },
  recordHolderWrap: { alignItems: 'flex-end' },
  recordHolder: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  recordHolderYou: { color: colors.primary },
  recordValue: { color: colors.text, fontWeight: '700', fontSize: 14 },
  compareContent: { padding: spacing.lg, gap: spacing.md },
  chipRow: { gap: spacing.xs, paddingBottom: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.primaryText },
  compareCard: { gap: spacing.sm },
  compareExerciseName: { ...typography.heading, fontSize: 14, color: colors.primary, textDecorationLine: 'underline' },
  compareHint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  radarCard: { gap: spacing.xs, alignItems: 'center' },
  radarTitle: { ...typography.heading, fontSize: 14, color: colors.text, alignSelf: 'flex-start' },
});
