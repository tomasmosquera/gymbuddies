import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useWorkoutSessionDetail, type WorkoutDetailExercise, type WorkoutDetailSet } from '@/hooks/useWorkoutSessionDetail';
import { totalVolumeKg } from '@/lib/domain/workoutSets';
import { computeMuscleSplit } from '@/lib/domain/workoutSession';
import { kgToUnit, sanitizeWeightInput } from '@/lib/domain/workoutUnits';
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

/**
 * One exercise's SET / weight / REPS table — same column shape as the live
 * workout-session.tsx and exercise-detail.tsx's Histórico tab. Tapping a set
 * opens it for editing (same "fix a typo after the fact" need as a still
 * in_progress session — see useWorkoutSessionDetail's doc comment for why
 * this is safe to allow on an already-completed one).
 */
function ExerciseDetailCard({
  exercise,
  unit,
  onUpdateSet,
  onDeleteSet,
}: {
  exercise: WorkoutDetailExercise;
  unit: WeightUnit;
  onUpdateSet: (setId: string, reps: number, weight: number | undefined, unit: WeightUnit) => Promise<void>;
  onDeleteSet: (setId: string) => Promise<void>;
}) {
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const startEditing = (set: WorkoutDetailSet) => {
    setEditingSetId(set.id);
    setEditWeight(set.weightKg !== null ? String(kgToUnit(set.weightKg, unit)) : '');
    setEditReps(String(set.reps));
  };

  const saveEdit = async () => {
    if (!editingSetId) return;
    const reps = Number(editReps) || 0;
    if (reps <= 0) {
      Alert.alert('Falta las repeticiones', 'Escribe cuántas repeticiones hiciste.');
      return;
    }
    setIsSaving(true);
    try {
      await onUpdateSet(editingSetId, reps, editWeight ? Number(editWeight) : undefined, unit);
      setEditingSetId(null);
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = (setId: string) => {
    Alert.alert('Borrar esta serie', 'Esto no se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          setIsSaving(true);
          try {
            await onDeleteSet(setId);
            setEditingSetId(null);
          } catch (err) {
            Alert.alert('No se pudo borrar', err instanceof Error ? err.message : 'Intenta de nuevo');
          } finally {
            setIsSaving(false);
          }
        },
      },
    ]);
  };

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
        <View style={styles.editColumn} />
      </View>
      {exercise.sets.map((set) =>
        editingSetId === set.id ? (
          <View key={set.id} style={styles.setRow}>
            <Text style={[styles.setNumber, styles.setColumn]}>{set.setNumber}</Text>
            <View style={styles.editInputsRow}>
              <TextInput
                style={styles.editInput}
                value={editWeight}
                onChangeText={(t) => setEditWeight(sanitizeWeightInput(t))}
                keyboardType="decimal-pad"
                placeholder="—"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
              <Text style={styles.editInputSep}>{unit} ×</Text>
              <TextInput
                style={styles.editInput}
                value={editReps}
                onChangeText={(t) => setEditReps(t.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.editColumn}>
              {isSaving ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Pressable onPress={() => confirmDelete(set.id)} hitSlop={8} accessibilityRole="button">
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                  <Pressable onPress={saveEdit} hitSlop={8} accessibilityRole="button">
                    <Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} />
                  </Pressable>
                </>
              )}
            </View>
          </View>
        ) : (
          <Pressable key={set.id} onPress={() => startEditing(set)} accessibilityRole="button">
            <View style={[styles.setRow, set.isWarmup && styles.setRowWarmup]}>
              <Text style={[styles.setNumber, styles.setColumn]}>{set.setNumber}</Text>
              <Text style={styles.setValue}>
                {set.weightKg !== null ? `${kgToUnit(set.weightKg, unit)} ${unit} × ${set.reps}` : `${set.reps} reps`}
              </Text>
              <View style={styles.editColumn}>
                <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
              </View>
            </View>
          </Pressable>
        )
      )}
    </Card>
  );
}

/** Perfil → Rutinas → Historial de entrenos → un entreno: everything logged that day — date, duration, total volume/sets, and every exercise's sets, each tappable into its own Resumen/Histórico/Grupo/Explicación detail, or tap a set itself to fix a mistyped weight/reps. */
export default function WorkoutDetailScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { profile } = useAuth();
  const { detail, isLoading, updateSet, deleteSet } = useWorkoutSessionDetail(sessionId);
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
        <ExerciseDetailCard key={exercise.id} exercise={exercise} unit={unit} onUpdateSet={updateSet} onDeleteSet={deleteSet} />
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
  setsTableHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tableHeaderCell: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  setColumn: { width: 32 },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  setRowWarmup: { opacity: 0.55 },
  setNumber: { color: colors.text, fontWeight: '700', fontSize: 14 },
  setValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  editColumn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 24, justifyContent: 'flex-end' },
  editInputsRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  editInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
    color: colors.text,
    fontSize: 14,
    textAlign: 'center',
    width: 56,
  },
  editInputSep: { color: colors.textMuted, fontSize: 12 },
});
