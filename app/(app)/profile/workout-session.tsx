import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ExercisePickerModal } from '@/components/ui/ExercisePickerModal';
import { useAuth } from '@/hooks/useAuth';
import { useRestTimer } from '@/hooks/useRestTimer';
import { useWorkoutSession, type WorkoutSessionExerciseWithDetails } from '@/hooks/useWorkoutSession';
import { usePreviousExercisePerformance } from '@/hooks/usePreviousExercisePerformance';
import { friendlyErrorMessage } from '@/lib/domain/errorMessages';
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
import { formatWeightUnit, kgToUnit, sanitizeWeightInput, unitToKg, type WeightUnit } from '@/lib/domain/workoutUnits';
import {
  BAR_WEIGHT_PRESETS,
  KG_PLATES,
  LBS_PLATES,
  barWeightInUnit,
  calculatePlateBreakdown,
  formatPlateBreakdown,
} from '@/lib/domain/plateCalculator';
import { replaceThenCrossTabNavigate } from '@/lib/navigation';
import { useExercisePickerDetourStore } from '@/state/exercisePickerDetourStore';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { Exercise, WorkoutSessionSetTarget, WorkoutSet } from '@/lib/supabase/types';

/** "60 kg × 8" for the read-only ANTERIOR/ÚLTIMA VEZ column — the exact weight/reps actually lifted last time (see WorkoutSessionSetTarget's doc comment), never the routine's own plan. A dash with no such history at all (first time ever doing this exercise, or this position has never been logged with a weight in it). */
function formatPreviousSet(target: WorkoutSessionSetTarget | undefined, unit: WeightUnit): string {
  if (!target || target.previous_weight_kg === null || target.previous_reps === null) return '—';
  return formatSetLine({ reps: target.previous_reps, weightKg: target.previous_weight_kg, isWarmup: false }, unit);
}

/** "ANTERIOR" for this same routine's own history, "ÚLTIMA VEZ" when that's empty and the column is instead showing the last time this exercise was done in any other routine (see is_last_time on WorkoutSessionSetTarget). */
function previousColumnLabel(snapshot: WorkoutSessionSetTarget[]): string {
  return snapshot.some((t) => t.is_last_time) ? 'ÚLTIMA VEZ' : 'ANTERIOR';
}

/** "8-10" (or just "8" when the range is a single number) — shown once in the REPS header, from the first planned set, as a reminder of the goal range. Different sets can plan different ranges (a pyramid scheme); this is only a representative hint, not per-row. */
function repRangeLabel(target: WorkoutSessionSetTarget): string {
  return `${target.target_reps_min}-${target.target_reps_max}`;
}

/** The biggest plate in each unit's own denomination list (see plateCalculator.ts) — a disc's size
 * on screen is its own weight relative to this, so a 20kg plate always draws at full size
 * regardless of whether the member next does an lbs exercise where 45 is the biggest. */
const MAX_PLATE_WEIGHT: Record<WeightUnit, number> = { kg: 20, lbs: 45 };

/** Bar + plates for the set a member is about to do, for a barbell-equipment exercise — drawn to
 * scale (biggest plate drawn biggest), same shape you'd actually see looking down the end of a
 * loaded bar: the bar's own segment first, then one plate per entry already in largest-to-smallest
 * order. Both sides are identical, so this only ever needs to show one. */
/** The bar + one plate per entry, largest-to-smallest, drawn to scale (biggest plate drawn
 * biggest) — the shape you'd actually see looking down the end of a loaded bar. Shared by the
 * picker (below, tappable to remove) and the breakdown view (read-only). */
function BarAndPlatesRow({
  barWeight,
  plates,
  maxPlateWeight,
  onRemoveAt,
}: {
  barWeight: number;
  plates: readonly number[];
  maxPlateWeight: number;
  onRemoveAt?: (index: number) => void;
}) {
  return (
    <View style={styles.plateRow}>
      <View style={styles.plateBar}>
        <Text style={styles.plateBarText} numberOfLines={1}>
          {barWeight}
        </Text>
      </View>
      {plates.map((plateWeight, i) => {
        const ratio = plateWeight / maxPlateWeight;
        const disc = (
          <View style={[styles.plateDisc, { height: 24 + ratio * 30, width: 22 + ratio * 14 }]}>
            <Text style={styles.plateDiscText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {plateWeight}
            </Text>
          </View>
        );
        return onRemoveAt ? (
          <Pressable key={i} onPress={() => onRemoveAt(i)} accessibilityRole="button" accessibilityLabel={`Quitar disco de ${plateWeight}`}>
            {disc}
          </Pressable>
        ) : (
          <View key={i}>{disc}</View>
        );
      })}
    </View>
  );
}

/** Quick, per-card override of which bar this set is actually on — a member alternating between a
 * straight bar for bench and an EZ bar for curls within the SAME workout shouldn't have to go into
 * Ajustes and back for each one. Local only (never written to profiles.default_bar_weight_kg,
 * which just seeds the initial pick here) — the kg side is the physical-object fact; the label
 * shown next to it is barWeightInUnit's marketed lbs number for lbs members, not a plain
 * conversion (see that function's doc comment). */
function BarTypeChips({ selectedBarKg, onSelect, unit }: { selectedBarKg: number; onSelect: (kg: number) => void; unit: WeightUnit }) {
  return (
    <View style={styles.barOptionRow}>
      {BAR_WEIGHT_PRESETS.map((option) => {
        const selected = option.kg === selectedBarKg;
        return (
          <Pressable
            key={option.kg}
            onPress={() => onSelect(option.kg)}
            style={[styles.barOptionChip, selected && styles.barOptionChipSelected]}
            accessibilityRole="button"
          >
            <Text style={[styles.barOptionChipText, selected && styles.barOptionChipTextSelected]}>
              {option.label} ({barWeightInUnit(option.kg, unit)}{unit})
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Typing a weight and picking plates are just two ways of arriving at the same number, so this
 * always shows both at once instead of switching between them: the current effective weight
 * (typed, suggested, or built up by tapping) is always broken down into plates via the same
 * greedy breakdown, each one tappable to remove (subtracting it back out of the field); the
 * "+plate" row below is always there too, to keep adding more regardless of how the weight so far
 * was reached. Both directions go through the same onPickWeight, which just writes a new total
 * into the field — typing and tapping are never tracked as separate states to stay in sync.
 */
function PlateHint({
  row,
  onPickWeight,
  barWeightKg,
  unit,
}: {
  row: PendingSetRow;
  onPickWeight: (weight: number) => void;
  barWeightKg: number;
  unit: WeightUnit;
}) {
  const [selectedBarKg, setSelectedBarKg] = useState(barWeightKg);
  const barWeight = barWeightInUnit(selectedBarKg, unit);
  const maxPlateWeight = MAX_PLATE_WEIGHT[unit];
  const denominations = unit === 'kg' ? KG_PLATES : LBS_PLATES;
  const targetWeight = effectivePendingWeight(row) ?? 0;
  const breakdown = calculatePlateBreakdown(targetWeight, barWeight, unit);

  return (
    <View style={styles.plateHint}>
      <BarAndPlatesRow
        barWeight={barWeight}
        plates={breakdown.plates}
        maxPlateWeight={maxPlateWeight}
        onRemoveAt={(i) => onPickWeight(Math.max(barWeight, targetWeight - 2 * breakdown.plates[i]))}
      />
      <Text style={styles.plateHintText}>{formatPlateBreakdown(breakdown, unit)}</Text>
      {breakdown.leftover > 0 ? (
        <Text style={styles.plateLeftoverText}>
          No se puede armar exacto con estos discos (sobran {breakdown.leftover} {unit} por lado)
        </Text>
      ) : null}
      <View style={styles.pickerPlateRow}>
        {denominations.map((plate) => (
          <Pressable
            key={plate}
            onPress={() => onPickWeight(targetWeight + 2 * plate)}
            style={styles.pickerPlateChip}
            accessibilityRole="button"
          >
            <Text style={styles.pickerPlateChipText}>+{plate}</Text>
          </Pressable>
        ))}
      </View>
      <BarTypeChips selectedBarKg={selectedBarKg} onSelect={setSelectedBarKg} unit={unit} />
    </View>
  );
}

/** One exercise card: progressive-overload reference, completed sets (from the DB), and pending/editable rows (local until confirmed). */
function ExerciseCard({
  sessionExercise,
  sessionId,
  onLogSet,
  onUpdateSet,
  onDeleteSet,
  onRemoveExercise,
  onReplaceExercise,
  defaultUnit,
  barWeightKg,
}: {
  sessionExercise: WorkoutSessionExerciseWithDetails;
  sessionId: string;
  onLogSet: (sessionExerciseId: string, reps: number, weight: number | undefined, unit: WeightUnit, restSeconds: number | null) => Promise<void>;
  onUpdateSet: (setId: string, reps: number, weight: number | undefined, unit: WeightUnit) => void;
  onDeleteSet: (setId: string) => void;
  onRemoveExercise: (sessionExerciseId: string) => void;
  onReplaceExercise: (sessionExerciseId: string) => void;
  defaultUnit: WeightUnit;
  barWeightKg: number;
}) {
  const [unit, setUnit] = useState<WeightUnit>(defaultUnit);
  const [pending, setPending] = useState<PendingSetRow[]>(() =>
    initialPendingRows(sessionExercise.target_sets_snapshot, sessionExercise.sets.length, defaultUnit)
  );
  // Which pending row's weight field has focus, if any — the plate hint (barbell exercises only)
  // shows for that one row while it's focused and nothing else, so it appears/disappears with the
  // keyboard instead of depending on whether a weight has been typed yet.
  const [focusedWeightIndex, setFocusedWeightIndex] = useState<number | null>(null);
  // Shown as completed the instant the member taps the checkmark, before the
  // log_set RPC even resolves — the fix for the set briefly disappearing
  // then popping back in "already checked" (that gap was two round trips:
  // the RPC, then a full session refresh; see useWorkoutSession's logSet for
  // the other half of this fix, which cut it to one). A fake id (never sent
  // to the server) marks a row as optimistic so it can't be tapped into
  // edit/delete before it's real; the effect below drops it once
  // sessionExercise.sets actually contains that logged set — matched by
  // set_number since the optimistic row never has the server's real id.
  const [optimisticSets, setOptimisticSets] = useState<WorkoutSet[]>([]);
  useEffect(() => {
    setOptimisticSets((opt) => opt.filter((o) => !sessionExercise.sets.some((s) => s.set_number === o.set_number)));
  }, [sessionExercise.sets]);
  const allSets = sessionExercise.sets.length || optimisticSets.length ? [...sessionExercise.sets, ...optimisticSets] : sessionExercise.sets;
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

  // Session-only removal — never touches the routine (see useWorkoutSession's
  // removeExercise). Warns specifically about losing logged sets only when
  // there actually are any to lose; an untouched exercise (the reported
  // case — decided not to do Pull Ups, never confirmed a set) gets a
  // lighter-weight confirmation.
  const confirmRemoveExercise = () => {
    const hasLoggedSets = sessionExercise.sets.length > 0;
    Alert.alert(
      `Quitar ${sessionExercise.exercise.name}`,
      hasLoggedSets
        ? 'Esto borra las series que ya registraste hoy para este ejercicio. La rutina no cambia — la próxima vez que la hagas, va a aparecer de nuevo.'
        : 'Se quita solo de este entreno. La rutina no cambia — la próxima vez que la hagas, va a aparecer de nuevo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => onRemoveExercise(sessionExercise.id) },
      ]
    );
  };

  const toggleUnit = () => {
    const nextUnit: WeightUnit = unit === 'kg' ? 'lbs' : 'kg';
    // targetWeight is what the member actually typed — kept a raw editable
    // number, no forced decimal. suggestedWeight/previousWeight are
    // read-only display text (a placeholder, and the ANTERIOR column) —
    // previousWeight used to just sit there unconverted when the unit
    // toggled (only the "kg"/"lbs" label next to it changed), which read as
    // the same number in a different unit; both now go through
    // formatWeightUnit like every other read-only weight in the app.
    const convertTyped = (w: string) => (w ? String(kgToUnit(unitToKg(Number(w) || 0, unit), nextUnit)) : w);
    const convertDisplay = (w: string) => (w ? formatWeightUnit(unitToKg(Number(w) || 0, unit), nextUnit) : w);
    setPending((rows) =>
      rows.map((r) => ({
        ...r,
        targetWeight: convertTyped(r.targetWeight),
        suggestedWeight: convertDisplay(r.suggestedWeight),
        previousWeight: convertDisplay(r.previousWeight),
      }))
    );
    setUnit(nextUnit);
  };

  const updatePending = (index: number, patch: Partial<PendingSetRow>) => {
    setPending((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addPending = () => setPending((rows) => [...rows, nextPendingRow(rows[rows.length - 1])]);
  const removePending = (index: number) => setPending((rows) => rows.filter((_, i) => i !== index));

  const confirm = async (index: number) => {
    const row = pending[index];
    const reps = effectivePendingReps(row);
    if (reps <= 0) {
      Alert.alert('Falta las repeticiones', 'Escribe cuántas repeticiones hiciste.');
      return;
    }
    const weight = effectivePendingWeight(row);
    const optimisticSet: WorkoutSet = {
      id: `optimistic-${Date.now()}-${Math.random()}`,
      session_exercise_id: sessionExercise.id,
      set_number: allSets.length + 1,
      reps,
      weight_kg: weight !== undefined ? unitToKg(weight, unit) : null,
      is_warmup: false,
      completed_at: new Date().toISOString(),
    };
    setOptimisticSets((prev) => [...prev, optimisticSet]);
    removePending(index);
    try {
      await onLogSet(sessionExercise.id, reps, weight, unit, sessionExercise.rest_seconds);
    } catch {
      // The RPC already alerted the member (handleLogSet, below) — this just
      // undoes the optimistic guess so it doesn't sit there forever "saved"
      // when it never actually was, and gives back what they'd typed.
      setOptimisticSets((prev) => prev.filter((s) => s.id !== optimisticSet.id));
      setPending((rows) => {
        const copy = [...rows];
        copy.splice(index, 0, row);
        return copy;
      });
    }
  };

  // Recomputed on every render (cheap, pure) — the same check
  // finish_workout_session itself runs, just live: true right after the set
  // that completes the pattern is confirmed, so the celebration lands at
  // the exact moment it's earned instead of only showing up next session.
  // Uses allSets (real + optimistic) so it lands the instant the deciding
  // set is tapped, not only once the server confirms it.
  const hitCeiling = reachedProgressiveOverloadCeiling(
    allSets.map((s) => ({ reps: s.reps, weightKg: s.weight_kg, isWarmup: s.is_warmup })),
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
        <Pressable
          onPress={() => onReplaceExercise(sessionExercise.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Reemplazar ${sessionExercise.exercise.name} en este entreno`}
        >
          <Ionicons name="swap-horizontal-outline" size={18} color={colors.textMuted} />
        </Pressable>
        <Pressable onPress={confirmRemoveExercise} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Quitar ${sessionExercise.exercise.name} de este entreno`}>
          <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
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
        <Text style={[styles.tableHeaderCell, styles.previousColumn]}>{previousColumnLabel(sessionExercise.target_sets_snapshot)}</Text>
        <Text style={[styles.tableHeaderCell, styles.weightColumn]}>{unit.toUpperCase()}</Text>
        <Text style={[styles.tableHeaderCell, styles.repsColumn]}>
          REPS{sessionExercise.target_sets_snapshot[0] ? ` (${repRangeLabel(sessionExercise.target_sets_snapshot[0])})` : ''}
        </Text>
        <View style={styles.actionColumn} />
      </View>

      {allSets.map((set, i) => {
        // A completed set's own ANTERIOR still reads from the snapshot at
        // this same position — it's "what you lifted last time", not "what
        // you're lifting today", so it doesn't change just because this set
        // itself is now logged.
        const previousText = formatPreviousSet(sessionExercise.target_sets_snapshot[i], unit);
        const isOptimistic = set.id.startsWith('optimistic-');
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
            {isOptimistic ? (
              // Still saving — not editable/deletable yet since there's no
              // real set id to send update_set/delete_set with. Reconciles
              // with the real row (see the effect above) within one round
              // trip, same icon either way so nothing visually "downgrades".
              <View style={styles.actionColumn}>
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              </View>
            ) : (
              <Pressable onPress={() => startEditingSet(set)} hitSlop={8} style={styles.actionColumn} accessibilityRole="button">
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              </Pressable>
            )}
          </View>
        );
      })}

      {pending.map((row, index) => (
        <View key={index}>
          <View style={styles.setRow}>
            <View style={[styles.setColumn, styles.setBadge, row.isFailureTarget && styles.setBadgeFailure]}>
              <Text style={[styles.setBadgeText, row.isFailureTarget && styles.setBadgeTextFailure]}>
                {row.isFailureTarget ? 'F' : allSets.length + index + 1}
              </Text>
            </View>
            <Text style={[styles.previousValue, styles.previousColumn]} numberOfLines={1}>
              {row.previousWeight && row.previousReps ? `${row.previousWeight} ${unit} × ${row.previousReps}` : '—'}
            </Text>
            <TextInput
              style={[styles.setInput, styles.weightColumn, row.isProgressiveOverloadSuggestion && styles.setInputOverload]}
              value={row.targetWeight}
              onChangeText={(t) => updatePending(index, { targetWeight: sanitizeWeightInput(t) })}
              onFocus={() => setFocusedWeightIndex(index)}
              onBlur={() => setFocusedWeightIndex((current) => (current === index ? null : current))}
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
          {sessionExercise.exercise.equipment === 'barbell' && focusedWeightIndex === index ? (
            <PlateHint
              row={row}
              onPickWeight={(w) => updatePending(index, { targetWeight: String(w) })}
              barWeightKg={barWeightKg}
              unit={unit}
            />
          ) : null}
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
  const { session, isLoading, addExercise, removeExercise, replaceExercise, logSet, updateLoggedSet, deleteLoggedSet, finish, discard } =
    useWorkoutSession();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // Which row's "Reemplazar" was tapped, if any — set while its own picker is open, read once a
  // substitute is actually chosen (see handleReplaceExercise), null the rest of the time. A
  // second, independent trigger for the SAME ExercisePickerModal instance as "+ Agregar
  // ejercicio" below, rather than a second modal — picking an exercise means two different things
  // depending on which trigger opened it.
  const [replacingSessionExerciseId, setReplacingSessionExerciseId] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const restTimer = useRestTimer();
  const insets = useSafeAreaInsets();
  const unit = profile?.weight_unit ?? 'kg';

  // Set by the routine Live Activity/Dynamic Island's "Saltar Descanso" button
  // (gymbuddies://profile/workout-session?skipRest=1) — opens the app AND skips
  // the rest in one tap, rather than just opening the screen and leaving the
  // member to tap Saltar again in here. Same consume-then-clear pattern as
  // checkin/index.tsx's own `checkout` param, so it can't re-trigger on a
  // later visit to this screen.
  const { skipRest: skipRestParam } = useLocalSearchParams<{ skipRest?: string }>();
  useEffect(() => {
    if (skipRestParam !== '1') return;
    if (restTimer.isActive) restTimer.skip();
    router.setParams({ skipRest: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipRestParam]);

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
      Alert.alert('No se pudo registrar la serie', friendlyErrorMessage(err));
      // Rethrown so ExerciseCard's confirm() (its caller) knows to undo its
      // optimistic row — this alert already told the member, so that catch
      // block doesn't show a second one.
      throw err;
    }
  };

  const handleUpdateSet = async (setId: string, reps: number, weight: number | undefined, setUnit: WeightUnit) => {
    try {
      await updateLoggedSet(setId, reps, weight, setUnit);
    } catch (err) {
      Alert.alert('No se pudo actualizar la serie', friendlyErrorMessage(err));
    }
  };

  const handleAddExercise = useCallback(
    async (exercise: Exercise) => {
      if (!session) return;
      try {
        await addExercise(session.id, exercise.id);
      } catch (err) {
        Alert.alert('No se pudo agregar el ejercicio', friendlyErrorMessage(err));
      }
    },
    [session, addExercise]
  );

  // The picker's own info ("i") icon — see exercisePickerDetourStore for why "back" from
  // exercise-detail needs this to land the member back in the (now-closed) picker instead of
  // bare on this screen. Captures which of the two modes (add vs. "Reemplazar") was open before
  // closing, since both share this one modal instance. canAddToSession (add mode only — a
  // substitute still needs the confirmation above, which the detail screen can't offer) lets
  // exercise-detail's own "Agregar al entreno" button add straight from there instead.
  const handleInfoPress = (exercise: Exercise) => {
    const wasReplacing = replacingSessionExerciseId;
    useExercisePickerDetourStore.getState().setReopenPicker(() => {
      if (wasReplacing) setReplacingSessionExerciseId(wasReplacing);
      else setIsPickerOpen(true);
    });
    router.push({
      pathname: '/profile/exercise-detail',
      params: wasReplacing ? { exerciseId: exercise.id } : { exerciseId: exercise.id, canAddToSession: '1' },
    });
  };

  useFocusEffect(
    useCallback(() => {
      const store = useExercisePickerDetourStore.getState();
      const toAdd = store.addToSession;
      if (toAdd) {
        store.setAddToSession(null);
        store.setReopenPicker(null);
        handleAddExercise(toAdd);
        return;
      }
      const reopen = store.reopenPicker;
      if (reopen) {
        store.setReopenPicker(null);
        reopen();
      }
    }, [handleAddExercise])
  );

  const handleRemoveExercise = async (sessionExerciseId: string) => {
    try {
      await removeExercise(sessionExerciseId);
    } catch (err) {
      Alert.alert('No se pudo quitar el ejercicio', friendlyErrorMessage(err));
    }
  };

  // Mirrors confirmRemoveExercise's own two-tier warning (ExerciseCard, above) — same session-only
  // guarantee, same "nothing to lose" vs "this discards logged sets" distinction — but the
  // confirmation can only happen here, once a substitute has actually been picked from the
  // ExercisePickerModal, not before: warning about losing sets before the member has even chosen
  // what they're switching to would be confusing.
  const handleReplaceExercise = (exercise: Exercise) => {
    if (!replacingSessionExerciseId || !session) return;
    const sessionExerciseId = replacingSessionExerciseId;
    const current = session.exercises.find((e) => e.id === sessionExerciseId);
    if (!current) return;
    const hasLoggedSets = current.sets.length > 0;
    const doReplace = async () => {
      try {
        await replaceExercise(sessionExerciseId, exercise.id);
      } catch (err) {
        Alert.alert('No se pudo reemplazar el ejercicio', friendlyErrorMessage(err));
      }
    };
    Alert.alert(
      `Reemplazar ${current.exercise.name} por ${exercise.name}`,
      hasLoggedSets
        ? 'Esto borra las series que ya registraste hoy para este ejercicio. La rutina no cambia — la próxima vez que la hagas, va a aparecer de nuevo.'
        : 'Se reemplaza solo en este entreno. La rutina no cambia — la próxima vez que la hagas, va a aparecer de nuevo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Reemplazar', style: hasLoggedSets ? 'destructive' : 'default', onPress: doReplace },
      ]
    );
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
            // it decide what to show. replaceThenCrossTabNavigate also cleans this
            // screen out of the Profile tab's own history — the useFocusEffect
            // above is a second line of defense for however else this screen
            // might be left dangling, not a substitute for this.
            replaceThenCrossTabNavigate('/profile', '/checkin');
          } catch (err) {
            Alert.alert('No se pudo terminar', friendlyErrorMessage(err));
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
          <View style={styles.restBarLeft}>
            <Ionicons name="timer" size={32} color={colors.primaryText} />
            <View>
              <Text style={styles.restBarText}>Descansando</Text>
              <Pressable onPress={restTimer.skip} accessibilityRole="button">
                <Text style={styles.restBarSkip}>Saltar</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.restBarTime}>{formatDuration(restTimer.remainingSeconds!)}</Text>
        </View>
      ) : null}

      {/* KeyboardAwareScrollView, not a plain ScrollView — this screen never
          had ANY keyboard handling before, so typing into the last
          exercise's weight/reps fields just got covered outright, with no
          way to see what was typed. This scrolls whichever field is
          actually focused into view above the keyboard, no matter how far
          down the list it is. */}
      <KeyboardAwareScrollView contentContainerStyle={styles.container} bottomOffset={spacing.lg} keyboardShouldPersistTaps="handled">
        {session.exercises.map((sessionExercise) => (
          <ExerciseCard
            key={sessionExercise.id}
            sessionExercise={sessionExercise}
            sessionId={session.id}
            onLogSet={handleLogSet}
            onUpdateSet={handleUpdateSet}
            onDeleteSet={deleteLoggedSet}
            onRemoveExercise={handleRemoveExercise}
            onReplaceExercise={setReplacingSessionExerciseId}
            defaultUnit={unit}
            barWeightKg={profile?.default_bar_weight_kg ?? 20}
          />
        ))}
        <Button label="+ Agregar ejercicio" onPress={() => setIsPickerOpen(true)} />
      </KeyboardAwareScrollView>

      <ExercisePickerModal
        visible={isPickerOpen || replacingSessionExerciseId !== null}
        onClose={() => {
          setIsPickerOpen(false);
          setReplacingSessionExerciseId(null);
        }}
        onSelect={replacingSessionExerciseId ? handleReplaceExercise : handleAddExercise}
        onInfoPress={handleInfoPress}
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
  // 3x the original footprint (mostly driven by paddingVertical going from
  // spacing.sm to spacing.lg, plus the now much larger text/icon) and the
  // countdown itself bigger than its own "Descansando:" label — both by
  // explicit request, so the remaining time reads easily from across the
  // room instead of needing to be held up close.
  restBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  restBarLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  restBarText: { color: colors.primaryText, fontWeight: '700', fontSize: 28 },
  restBarTime: { color: colors.primaryText, fontWeight: '800', fontSize: 40 },
  restBarSkip: { color: colors.primaryText, fontWeight: '700', textDecorationLine: 'underline', fontSize: 18 },
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
  plateHint: {
    marginTop: 2,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    backgroundColor: 'rgba(61, 220, 151, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(61, 220, 151, 0.35)',
    borderRadius: radii.md,
    gap: 6,
    alignItems: 'center',
  },
  plateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, alignSelf: 'stretch' },
  plateBar: {
    width: 36,
    height: 20,
    borderRadius: 4,
    backgroundColor: '#5B6472',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateBarText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  plateDisc: {
    borderRadius: 4,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  plateDiscText: { color: colors.primaryText, fontSize: 11, fontWeight: '700' },
  plateHintText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  plateLeftoverText: { color: colors.warning, fontSize: 11 },
  pickerPlateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  pickerPlateChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  pickerPlateChipText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  barOptionRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  barOptionChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(61, 220, 151, 0.4)',
  },
  barOptionChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  barOptionChipText: { color: colors.primary, fontSize: 11, fontWeight: '600' },
  barOptionChipTextSelected: { color: colors.primaryText },
});
