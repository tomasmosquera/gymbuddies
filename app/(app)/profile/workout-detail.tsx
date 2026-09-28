import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '@/hooks/useAuth';
import { useWorkoutSessionDetail, type WorkoutDetailExercise } from '@/hooks/useWorkoutSessionDetail';
import { totalVolumeKg } from '@/lib/domain/workoutSets';
import { computeMuscleSplit } from '@/lib/domain/workoutSession';
import { kgToUnit } from '@/lib/domain/workoutUnits';
import { Card } from '@/components/ui/Card';
import { MUSCLE_GROUP_LABELS } from '@/constants/muscleGroups';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { WeightUnit } from '@/lib/domain/workoutUnits';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—';
  const totalMinutes = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}min`;
}

/** One exercise's read-only SET / weight / REPS table — same column shape as the live workout-session.tsx and exercise-detail.tsx's Histórico tab, just nothing to edit since this session is already completed. */
function ExerciseDetailCard({ exercise, unit }: { exercise: WorkoutDetailExercise; unit: WeightUnit }) {
  return (
    <Card style={styles.exerciseCard}>
      <Pressable
        style={styles.exerciseHeader}
        onPress={() => router.push({ pathname: '/profile/exercise-detail', params: { exerciseId: exercise.exerciseId } })}
        accessibilityRole="button"
      >
        {exercise.gifUrl ? (
          <Image source={{ uri: exercise.gifUrl }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={styles.thumbPlaceholder} />
        )}
        <Text style={styles.exerciseName} numberOfLines={2}>
          {exercise.exerciseName}
        </Text>
      </Pressable>

      <View style={styles.setsTableHeader}>
        <Text style={[styles.tableHeaderCell, styles.setColumn]}>SET</Text>
        <Text style={styles.tableHeaderCell}>PESO Y REPS</Text>
      </View>
      {exercise.sets.map((set) => (
        <View key={set.id} style={[styles.setRow, set.isWarmup && styles.setRowWarmup]}>
          <Text style={[styles.setNumber, styles.setColumn]}>{set.setNumber}</Text>
          <Text style={styles.setValue}>
            {set.weightKg !== null ? `${kgToUnit(set.weightKg, unit)} ${unit} × ${set.reps}` : `${set.reps} reps`}
          </Text>
        </View>
      ))}
    </Card>
  );
}

/** Perfil → Rutinas → Historial de entrenos → un entreno: everything logged that day — date, duration, total volume/sets, and every exercise's sets, each tappable into its own Resumen/Histórico/Grupo/Explicación detail. Read-only (edit that live is workout-session.tsx's job, for a session still in_progress). */
export default function WorkoutDetailScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { profile } = useAuth();
  const { detail, isLoading } = useWorkoutSessionDetail(sessionId);
  const unit = profile?.weight_unit ?? 'kg';

  const muscleSplit = useMemo(() => computeMuscleSplit(detail?.exercises.map((e) => e.muscleGroup) ?? []), [detail]);

  if (isLoading || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const allSets = detail.exercises.flatMap((e) => e.sets.map((s) => ({ reps: s.reps, weightKg: s.weightKg, isWarmup: s.isWarmup })));
  const totalSets = allSets.filter((s) => !s.isWarmup).length;
  const volumeKg = totalVolumeKg(allSets);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>{detail.label}</Text>
      <Text style={styles.date}>{formatDateTime(detail.startedAt)}</Text>

      <Card style={styles.statsCard}>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>Duración</Text>
          <Text style={styles.statValue}>{formatDuration(detail.startedAt, detail.finishedAt)}</Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>Volumen</Text>
          <Text style={styles.statValue}>
            {kgToUnit(volumeKg, unit)} {unit}
          </Text>
        </View>
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>Sets</Text>
          <Text style={styles.statValue}>{totalSets}</Text>
        </View>
      </Card>

      {muscleSplit.length > 0 ? (
        <Card style={styles.splitCard}>
          <Text style={styles.splitTitle}>Muscle Split</Text>
          {muscleSplit.map(({ group, percent }) => (
            <View key={group} style={styles.splitRow}>
              <Text style={styles.splitLabel}>{MUSCLE_GROUP_LABELS[group]}</Text>
              <View style={styles.splitBarRow}>
                <View style={styles.splitBarTrack}>
                  <View style={[styles.splitBarFill, { width: `${percent}%` }]} />
                </View>
                <Text style={styles.splitPercent}>{percent}%</Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {detail.exercises.map((exercise) => (
        <ExerciseDetailCard key={exercise.id} exercise={exercise} unit={unit} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  label: { ...typography.title, fontSize: 22, color: colors.text },
  date: { color: colors.textMuted, fontSize: 13, textTransform: 'capitalize' },
  statsCard: { flexDirection: 'row', justifyContent: 'space-around' },
  statBlock: { alignItems: 'center', gap: 2 },
  statLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '700' },
  splitCard: { gap: spacing.sm },
  splitTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  splitRow: { gap: 4 },
  splitLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  splitBarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  splitBarTrack: { flex: 1, height: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  splitBarFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.primary },
  splitPercent: { width: 40, textAlign: 'right', color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  exerciseCard: { gap: spacing.sm },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: { width: 36, height: 36, borderRadius: radii.sm, backgroundColor: '#FFFFFF' },
  thumbPlaceholder: { width: 36, height: 36, borderRadius: radii.sm, backgroundColor: colors.surfaceAlt },
  exerciseName: { flex: 1, color: colors.primary, fontWeight: '700', fontSize: 16, textDecorationLine: 'underline' },
  setsTableHeader: { flexDirection: 'row', gap: spacing.sm },
  tableHeaderCell: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  setColumn: { width: 32 },
  setRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs + 2, borderTopWidth: 1, borderTopColor: colors.border },
  setRowWarmup: { opacity: 0.55 },
  setNumber: { color: colors.text, fontWeight: '700', fontSize: 14 },
  setValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
