import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ExercisePickerModal } from '@/components/ui/ExercisePickerModal';
import { useAuth } from '@/hooks/useAuth';
import { useRestTimer } from '@/hooks/useRestTimer';
import { useWorkoutSession, type WorkoutSessionExerciseWithDetails } from '@/hooks/useWorkoutSession';
import { usePreviousExercisePerformance } from '@/hooks/usePreviousExercisePerformance';
import { formatSetLine } from '@/lib/domain/workoutSets';
import {
  effectivePendingReps,
  effectivePendingWeight,
  formatDuration,
  initialPendingRows,
  nextPendingRow,
  reachedProgressiveOverloadCeiling,
  type PendingSetRow,
} from '@/lib/domain/workoutSession';
import { kgToUnit, sanitizeWeightInput, unitToKg, type WeightUnit } from '@/lib/domain/workoutUnits';
import { replaceThenCrossTabPush } from '@/lib/navigation';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { Exercise, WorkoutSessionSetTarget, WorkoutSet } from '@/lib/supabase/types';

/** "60 kg × 8" for the read-only ANTERIOR column — the exact weight/reps actually lifted last time this routine was done at this set position (see WorkoutSessionSetTarget's doc comment), never the routine's own plan. A dash with no such history at all (first time doing this routine, or this position/exercise has never been logged with a weight in it). */
function formatPreviousSet(target: WorkoutSessionSetTarget | undefined, unit: WeightUnit): string {
  if (!target || target.previous_weight_kg === null || target.previous_reps === null) return '—';
  return formatSetLine({ reps: target.previous_reps, weightKg: target.previous_weight_kg, isWarmup: false }, unit);
}

/** "8-10" (or just "8" when the range is a single number) — shown once in the REPS header, from the first planned set, as a reminder of the goal range. Different sets can plan different ranges (a pyramid scheme); this is only a representative hint, not per-row. */
function repRangeLabel(target: WorkoutSessionSetTarget): string {
  return `${target.target_reps_min}-${target.target_reps_max}`;
}

/** One exercise card: progressive-overload reference, completed sets (from the DB), and pending/editable rows (local until confirmed). */
function ExerciseCard({
  sessionExercise,
  sessionId,
  onLogSet,
  onUpdateSet,
  onDeleteSet,
  defaultUnit,
}: {
  sessionExercise: WorkoutSessionExerciseWithDetails;
  sessionId: string;
  onLogSet: (sessionExerciseId: string, reps: number, weight: number | undefined, unit: WeightUnit, restSeconds: number | null) => void;
  onUpdateSet: (setId: string, reps: number, weight: number | undefined, unit: WeightUnit) => void;
  onDeleteSet: (setId: string) => void;
  defaultUnit: WeightUnit;
}) {
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [pending, setPending] = useState<PendingSetRow[]>(() =>
    initialPendingRows(sessionExercise.target_sets_snapshot, sessionExercise.sets.length, defaultUnit)
  );
  // A completed (logged) set tapped back open for editing — separate from
  // `pending` (never-yet-logged rows) since this one already exists in the
  // DB and needs update_set, not log_set, when confirmed again.
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState('');
  const [editReps, setEditReps] = useState('');
  const { sets: previousSets } = usePreviousExercisePerformance(sessionExercise.exercise_id, sessionId);

  const startEditingSet = (set: WorkoutSet) => {
    setEditingSetId(set.id);
    setEditWeight(set.weight_kg !== null ? String(kgToUnit(set.weight_kg, unit)) : '');
    setEditReps(String(set.reps));
  };

  const saveEditedSet = () => {
    if (!editingSetId) return;
    const reps = Number(editReps) || 0;
    if (reps <= 0) {
      Alert.alert('Falta las repeticiones', 'Escribe cuántas repeticiones hiciste.');
      return;
    }
    onUpdateSet(editingSetId, reps, editWeight ? Number(editWeight) : undefined, unit);
    setEditingSetId(null);
  };

  const confirmDeleteSet = (setId: string) => {
    Alert.alert('Borrar esta serie', 'Esto no se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: () => {
          onDeleteSet(setId);
          setEditingSetId(null);
        },
      },
    ]);
  };

  const toggleUnit = () => {
    const nextUnit: WeightUnit = unit === 'kg' ? 'lbs' : 'kg';
    const convert = (w: string) => (w ? String(kgToUnit(unitToKg(Number(w) || 0, unit), nextUnit)) : w);
    setPending((rows) => rows.map((r) => ({ ...r, targetWeight: convert(r.targetWeight), suggestedWeight: convert(r.suggestedWeight) })));
    setUnit(nextUnit);
  };

  const updatePending = (index: number, patch: Partial<PendingSetRow>) => {
    setPending((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addPending = () => setPending((rows) => [...rows, nextPendingRow(rows[rows.length - 1])]);
  const removePending = (index: number) => setPending((rows) => rows.filter((_, i) => i !== index));

  const confirm = (index: number) => {
    const row = pending[index];
    const reps = effectivePendingReps(row);
    if (reps <= 0) {
      Alert.alert('Falta las repeticiones', 'Escribe cuántas repeticiones hiciste.');
      return;
    }
    onLogSet(sessionExercise.id, reps, effectivePendingWeight(row), unit, sessionExercise.rest_seconds);
    removePending(index);
  };

  // Recomputed on every render (cheap, pure) — the same check
  // finish_workout_session itself runs, just live: true right after the set
  // that completes the pattern is confirmed, so the celebration lands at
  // the exact moment it's earned instead of only showing up next session.
  const hitCeiling = reachedProgressiveOverloadCeiling(
    sessionExercise.sets.map((s) => ({ reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup })),
    sessionExercise.target_sets_snapshot.map((t) => ({ targetRepsMax: t.target_reps_max, isFailureTarget: t.is_failure_target }))
  );

  return (
    <Card style={styles.exerciseCard}>
      <View style={styles.exerciseHeader}>
        <Pressable
          style={styles.exerciseNameButton}
          onPress={() => router.push({ pathname: '/profile/exercise-detail', params: { exerciseId: sessionExercise.exercise_id } })}
          accessibilityRole="button"
        >
          <Text style={styles.exerciseName} numberOfLines={2}>
            {sessionExercise.exercise.name}
          </Text>
        </Pressable>
        <Pressable onPress={toggleUnit} style={styles.unitPill} accessibilityRole="button">
          <Text style={styles.unitPillText}>{unit.toUpperCase()}</Text>
        </Pressable>
      </View>

      {/* Only for an exercise added mid-session (not part of the routine's own
          plan) — those never get an ANTERIOR column (target_sets_snapshot is
          empty), so this is their only historical reference. A planned
          exercise already shows the exact same info per set in ANTERIOR
          below; repeating it here would just be the same numbers twice. */}
      {sessionExercise.target_sets_snapshot.length === 0 && previousSets && previousSets.length > 0 ? (
        <Text style={styles.previousLine} numberOfLines={1}>
          Última vez: {previousSets.map((s) => formatSetLine({ reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup }, unit)).join(', ')}
        </Text>
      ) : null}

      {hitCeiling ? (
        <View style={styles.overloadBanner}>
          <Ionicons name="trending-up" size={16} color={colors.success} />
          <Text style={styles.overloadBannerText}>¡Llegaste al tope! La próxima vez subes de peso en este ejercicio.</Text>
        </View>
      ) : null}

      <View style={styles.setsTableHeader}>
        <Text style={[styles.tableHeaderCell, styles.setColumn]}>SERIE</Text>
        <Text style={[styles.tableHeaderCell, styles.previousColumn]}>ANTERIOR</Text>
        <Text style={[styles.tableHeaderCell, styles.weightColumn]}>{unit.toUpperCase()}</Text>
        <Text style={[styles.tableHeaderCell, styles.repsColumn]}>
          REPS{sessionExercise.target_sets_snapshot[0] ? ` (${repRangeLabel(sessionExercise.target_sets_snapshot[0])})` : ''}
        </Text>
        <View style={styles.actionColumn} />
      </View>

      {sessionExercise.sets.map((set, i) => {
        // A completed set's own ANTERIOR still reads from the snapshot at
        // this same position — it's "what you lifted last time", not "what
        // you're lifting today", so it doesn't change just because this set
        // itself is now logged.
        const previousText = formatPreviousSet(sessionExercise.target_sets_snapshot[i], unit);
        if (editingSetId === set.id) {
          return (
            <View key={set.id} style={styles.setRow}>
              <View style={[styles.setColumn, styles.setBadge]}>
                <Text style={styles.setBadgeText}>{i + 1}</Text>
              </View>
              <Text style={[styles.previousValue, styles.previousColumn]} numberOfLines={1}>
                {previousText}
              </Text>
              <TextInput
                style={[styles.setInput, styles.weightColumn]}
                value={editWeight}
                onChangeText={(t) => setEditWeight(sanitizeWeightInput(t))}
                keyboardType="decimal-pad"
                placeholder="—"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
              <TextInput
                style={[styles.setInput, styles.repsColumn]}
                value={editReps}
                onChangeText={(t) => setEditReps(t.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.editActions}>
                <Pressable onPress={() => confirmDeleteSet(set.id)} hitSlop={8} accessibilityRole="button">
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
                <Pressable onPress={saveEditedSet} hitSlop={8} accessibilityRole="button">
                  <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
                </Pressable>
              </View>
            </View>
          );
        }
        return (
          <View key={set.id} style={[styles.setRow, styles.setRowCompleted]}>
            <View style={[styles.setColumn, styles.setBadge, styles.setBadgeCompleted]}>
              <Text style={styles.setBadgeTextCompleted}>{i + 1}</Text>
            </View>
            <Text style={[styles.previousValue, styles.previousColumn]} numberOfLines={1}>
              {previousText}
            </Text>
            <Text style={[styles.completedValue, styles.weightColumn]}>{set.weight_kg !== null ? kgToUnit(set.weight_kg, unit) : '—'}</Text>
            <Text style={[styles.completedValue, styles.repsColumn]}>{set.reps}</Text>
            <Pressable onPress={() => startEditingSet(set)} hitSlop={8} style={styles.actionColumn} accessibilityRole="button">
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
            </Pressable>
          </View>
        );
      })}

      {pending.map((row, index) => (
        <View key={index} style={styles.setRow}>
          <View style={[styles.setColumn, styles.setBadge, row.isFailureTarget && styles.setBadgeFailure]}>
            <Text style={[styles.setBadgeText, row.isFailureTarget && styles.setBadgeTextFailure]}>
              {row.isFailureTarget ? 'F' : sessionExercise.sets.length + index + 1}
            </Text>
          </View>
          <Text style={[styles.previousValue, styles.previousColumn]} numberOfLines={1}>
            {row.previousWeight && row.previousReps ? `${row.previousWeight} ${unit} × ${row.previousReps}` : '—'}
          </Text>
          <TextInput
            style={[styles.setInput, styles.weightColumn, row.isProgressiveOverloadSuggestion && styles.setInputOverload]}
            value={row.targetWeight}
            onChangeText={(t) => updatePending(index, { targetWeight: sanitizeWeightInput(t) })}
            keyboardType="decimal-pad"
            placeholder={row.suggestedWeight || '—'}
            placeholderTextColor={row.isProgressiveOverloadSuggestion ? colors.success : colors.textMuted}
          />
          <TextInput
            style={[styles.setInput, styles.repsColumn]}
            value={row.targetReps}
            onChangeText={(t) => updatePending(index, { targetReps: t.replace(/[^0-9]/g, '') })}
            keyboardType="numeric"
            placeholder={row.suggestedReps || '0'}
            placeholderTextColor={colors.textMuted}
          />
          <Pressable onPress={() => confirm(index)} hitSlop={8} style={styles.actionColumn} accessibilityRole="button">
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}

      <Button label="+ Agregar serie" variant="secondary" onPress={addPending} />
    </Card>
  );
}

/**
 * The live workout. Reachable from Perfil → Rutinas (start a routine, or
 * "Elegir ejercicios"), or from the check-in flow's own routine-choice step.
 * At most one session in_progress at a time, so this screen takes no
 * params — it always shows whichever one that is.
 */
export default function WorkoutSessionScreen() {
  const { profile } = useAuth();
  const { session, isLoading, addExercise, logSet, updateLoggedSet, deleteLoggedSet, finish, discard } = useWorkoutSession();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const restTimer = useRestTimer();
  const insets = useSafeAreaInsets();
  const unit = profile?.weight_unit ?? 'kg';

  // Redirects out once there's genuinely nothing to show (finished/discarded, or none was ever started) —
  // this screen doesn't create one itself. useFocusEffect, not useEffect: a
  // cross-tab push (Terminar → /checkin below) leaves this screen
  // mounted-but-unfocused behind in the Profile tab's own history instead of
  // unmounting it, so a plain useEffect's [isLoading, session] dependencies
  // never change again once they've already settled to false/null — it
  // would only ever redirect once, and switching back to this exact tab
  // later would silently re-show this same screen stuck on its own loading
  // spinner forever (session gone, nothing left to load). Re-checking on
  // every focus instead means simply returning to this screen with nothing
  // to show self-heals by redirecting away again, no matter how it was left
  // behind.
  //
  // Target is /profile (the tab's own root), not /profile/routines: this
  // screen is reached two structurally different ways — Perfil → Rutinas →
  // Empezar (a deep stack, replacing with routines still leaves plenty
  // beneath it to go back to) and the check-in flow's cross-tab push
  // (Rutina/Elegir ejercicios in routine-choice.tsx), which lands here as
  // this tab's ONLY stack entry. Replacing that one entry with routines
  // makes routines the de-facto root — no screen left beneath it — so the
  // header shows no back button and the tab reads as permanently stuck
  // there. /profile always has somewhere real to go from it regardless of
  // which path got here.
  useFocusEffect(
    useCallback(() => {
      if (!isLoading && !session) {
        router.replace('/profile');
      }
    }, [isLoading, session])
  );

  const handleLogSet = async (sessionExerciseId: string, reps: number, weight: number | undefined, setUnit: WeightUnit, restSeconds: number | null) => {
    try {
      await logSet(sessionExerciseId, reps, weight, setUnit);
      if (restSeconds) restTimer.start(restSeconds);
    } catch (err) {
      Alert.alert('No se pudo registrar la serie', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleUpdateSet = async (setId: string, reps: number, weight: number | undefined, setUnit: WeightUnit) => {
    try {
      await updateLoggedSet(setId, reps, weight, setUnit);
    } catch (err) {
      Alert.alert('No se pudo actualizar la serie', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleAddExercise = async (exercise: Exercise) => {
    if (!session) return;
    try {
      await addExercise(session.id, exercise.id);
    } catch (err) {
      Alert.alert('No se pudo agregar el ejercicio', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleFinish = () => {
    if (!session) return;
    Alert.alert('Terminar entreno', '¿Ya terminaste? Vas a guardar todo lo que registraste.', [
      { text: 'Seguir entrenando', style: 'cancel' },
      {
        text: 'Terminar',
        onPress: async () => {
          setIsFinishing(true);
          try {
            await finish(session.id);
            // Terminar the workout is the natural moment to prompt for the
            // checkout photo, not "go manage your routines" — checkin/index.tsx
            // already knows on its own whether one's actually pending (Paso 2)
            // or there's nothing to do, so this always routes there and lets
            // it decide what to show. replaceThenCrossTabPush also cleans this
            // screen out of the Profile tab's own history — the useFocusEffect
            // above is a second line of defense for however else this screen
            // might be left dangling, not a substitute for this.
            replaceThenCrossTabPush('/profile', '/checkin');
          } catch (err) {
            Alert.alert('No se pudo terminar', err instanceof Error ? err.message : 'Intenta de nuevo');
          } finally {
            setIsFinishing(false);
          }
        },
      },
    ]);
  };

  const handleDiscard = () => {
    if (!session) return;
    Alert.alert('Cancelar entreno', 'Se borra todo lo que registraste en este entreno. Esto no se puede deshacer.', [
      { text: 'Seguir entrenando', style: 'cancel' },
      {
        text: 'Cancelar entreno',
        style: 'destructive',
        onPress: async () => {
          await discard(session.id);
          // /profile, not /profile/routines — see the useFocusEffect above
          // for why: this screen can be this tab's only stack entry
          // (reached via the check-in flow), and replacing that one entry
          // with routines would leave no screen to go back to.
          router.replace('/profile');
        },
      },
    ]);
  };

  if (isLoading || !session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={handleDiscard} hitSlop={8} style={styles.headerAction} accessibilityRole="button">
          <Text style={styles.headerActionTextSecondary}>Cancelar</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {session.routine_name_snapshot ?? 'Entreno libre'}
        </Text>
        <Pressable
          onPress={handleFinish}
          hitSlop={8}
          disabled={isFinishing}
          style={styles.headerAction}
          accessibilityRole="button"
        >
          {isFinishing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.headerActionText}>Terminar</Text>
          )}
        </Pressable>
      </View>

      {restTimer.isActive ? (
        <View style={styles.restBar}>
          <Ionicons name="timer" size={18} color={colors.primaryText} />
          <Text style={styles.restBarText}>Descansando: {formatDuration(restTimer.remainingSeconds!)}</Text>
          <Pressable onPress={restTimer.skip} accessibilityRole="button">
            <Text style={styles.restBarSkip}>Saltar</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {session.exercises.map((sessionExercise) => (
          <ExerciseCard
            key={sessionExercise.id}
            sessionExercise={sessionExercise}
            sessionId={session.id}
            onLogSet={handleLogSet}
            onUpdateSet={handleUpdateSet}
            onDeleteSet={deleteLoggedSet}
            defaultUnit={unit}
          />
        ))}
        <Button label="+ Agregar ejercicio" onPress={() => setIsPickerOpen(true)} />
      </ScrollView>

      <ExercisePickerModal
        visible={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelect={handleAddExercise}
        excludeIds={session.exercises.map((e) => e.exercise_id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerAction: { minWidth: 68, paddingVertical: spacing.xs, alignItems: 'center', justifyContent: 'center' },
  headerActionText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  headerActionTextSecondary: { color: colors.textMuted, fontWeight: '600', fontSize: 15 },
  title: { ...typography.heading, fontSize: 16, color: colors.text, flex: 1, textAlign: 'center' },
  restBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
  },
  restBarText: { color: colors.primaryText, fontWeight: '700' },
  restBarSkip: { color: colors.primaryText, fontWeight: '700', textDecorationLine: 'underline' },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
  exerciseCard: { gap: spacing.sm },
  exerciseHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  exerciseNameButton: { flex: 1 },
  exerciseName: { color: colors.primary, fontWeight: '700', fontSize: 16, textDecorationLine: 'underline' },
  unitPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  unitPillText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  previousLine: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  overloadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(61, 220, 151, 0.12)',
    borderRadius: radii.sm,
    padding: spacing.xs,
  },
  overloadBannerText: { flex: 1, color: colors.success, fontSize: 12, fontWeight: '600' },
  setsTableHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  tableHeaderCell: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  setRowCompleted: { opacity: 0.85 },
  setColumn: { width: 34 },
  previousColumn: { width: 72 },
  previousValue: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  weightColumn: { flex: 1 },
  repsColumn: { flex: 1 },
  actionColumn: { width: 28, alignItems: 'center' },
  editActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, width: 60, justifyContent: 'flex-end' },
  setBadge: {
    height: 28,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setBadgeCompleted: { backgroundColor: 'rgba(61, 220, 151, 0.15)' },
  setBadgeFailure: { backgroundColor: 'rgba(255,107,107,0.15)' },
  setBadgeText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  setBadgeTextCompleted: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  setBadgeTextFailure: { color: colors.danger },
  completedValue: { color: colors.text, fontWeight: '600', fontSize: 14, textAlign: 'center' },
  setInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: 4,
    color: colors.text,
    fontSize: 14,
    textAlign: 'center',
  },
  // Marks a weight suggested by Progressive Overload (the routine's history
  // hit the top of its rep range last time, so this is last time's weight
  // plus the fixed increment) — same emerald as overloadBanner above, so the
  // two visually read as the same feature. Border only — the placeholder
  // text itself is colored separately (placeholderTextColor, inline) since
  // `color` here would tint whatever the member actually types too, which
  // should look like a normal typed number, not still "the PO suggestion".
  setInputOverload: { borderColor: colors.success, borderWidth: 2 },
});
