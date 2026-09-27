import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { ExercisePickerModal } from '@/components/ui/ExercisePickerModal';
import { colors, radii, spacing } from '@/constants/theme';
import type { WeightUnit } from '@/lib/domain/workoutUnits';
import type { Exercise } from '@/lib/supabase/types';

/** One row of the planned SET / weight / REPS table — raw strings while editing, same reason MoneyField/PrizeSplitEditor keep numeric fields as text (never flash NaN). */
export interface RoutineExerciseSetFormRow {
  targetReps: string;
  targetWeight: string;
  isFailureTarget: boolean;
}

export interface RoutineExerciseFormRow {
  exerciseId: string;
  exerciseName: string;
  /** Minutes/seconds kept apart in the form, matching how the rest timer is displayed ("2min 0s") — combined into total seconds on submit. */
  restMinutes: string;
  restSeconds: string;
  notes: string;
  sets: RoutineExerciseSetFormRow[];
}

interface RoutineExerciseListEditorProps {
  values: RoutineExerciseFormRow[];
  onChange: (values: RoutineExerciseFormRow[]) => void;
  unit: WeightUnit;
}

function defaultSet(): RoutineExerciseSetFormRow {
  return { targetReps: '10', targetWeight: '', isFailureTarget: false };
}

export function exerciseToFormRow(exercise: Exercise): RoutineExerciseFormRow {
  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    restMinutes: '',
    restSeconds: '',
    notes: '',
    sets: [defaultSet(), defaultSet(), defaultSet()],
  };
}

/**
 * The list of exercises inside a routine being created/edited, styled after
 * a reference screenshot of Hevy's own routine editor: per exercise, a rest
 * timer, a free-text note line (e.g. "6 to 8, 1-2 RIR, failure on the last
 * set"), and an editable SET / weight / REPS table — tapping a set's number
 * toggles it between a normal set and an "F" (to-failure) target set.
 * "+ Add Set" copies the last row's numbers forward, same as Hevy, so a
 * routine with identical sets only needs typing once.
 */
export function RoutineExerciseListEditor({ values, onChange, unit }: RoutineExerciseListEditorProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const updateExercise = (index: number, patch: Partial<RoutineExerciseFormRow>) => {
    onChange(values.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };
  const removeExercise = (index: number) => onChange(values.filter((_, i) => i !== index));
  const addExercise = (exercise: Exercise) => onChange([...values, exerciseToFormRow(exercise)]);

  const updateSet = (exerciseIndex: number, setIndex: number, patch: Partial<RoutineExerciseSetFormRow>) => {
    const exercise = values[exerciseIndex];
    const sets = exercise.sets.map((s, i) => (i === setIndex ? { ...s, ...patch } : s));
    updateExercise(exerciseIndex, { sets });
  };
  const addSet = (exerciseIndex: number) => {
    const exercise = values[exerciseIndex];
    const last = exercise.sets[exercise.sets.length - 1];
    updateExercise(exerciseIndex, { sets: [...exercise.sets, last ? { ...last, isFailureTarget: false } : defaultSet()] });
  };
  const removeSet = (exerciseIndex: number, setIndex: number) => {
    const exercise = values[exerciseIndex];
    updateExercise(exerciseIndex, { sets: exercise.sets.filter((_, i) => i !== setIndex) });
  };

  return (
    <View style={styles.container}>
      {values.map((exercise, exerciseIndex) => (
        <View key={exercise.exerciseId} style={styles.exerciseCard}>
          <View style={styles.exerciseHeader}>
            <Text style={styles.exerciseName} numberOfLines={2}>
              {exercise.exerciseName}
            </Text>
            <Pressable onPress={() => removeExercise(exerciseIndex)} hitSlop={8} accessibilityRole="button">
              <Ionicons name="close-circle" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <TextInput
            style={styles.notesInput}
            value={exercise.notes}
            onChangeText={(t) => updateExercise(exerciseIndex, { notes: t })}
            placeholder="Notas (ej. 6 a 8 reps, 1-2 RIR, fallo en la última)"
            placeholderTextColor={colors.textMuted}
            multiline
          />

          <View style={styles.restRow}>
            <Ionicons name="timer-outline" size={16} color={colors.primary} />
            <Text style={styles.restLabel}>Descanso:</Text>
            <TextInput
              style={styles.restInput}
              value={exercise.restMinutes}
              onChangeText={(t) => updateExercise(exerciseIndex, { restMinutes: t.replace(/[^0-9]/g, '') })}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.restUnit}>min</Text>
            <TextInput
              style={styles.restInput}
              value={exercise.restSeconds}
              onChangeText={(t) => updateExercise(exerciseIndex, { restSeconds: t.replace(/[^0-9]/g, '') })}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.restUnit}>seg</Text>
          </View>

          <View style={styles.setsTableHeader}>
            <Text style={[styles.tableHeaderCell, styles.setColumn]}>SERIE</Text>
            <Text style={[styles.tableHeaderCell, styles.weightColumn]}>{unit.toUpperCase()}</Text>
            <Text style={[styles.tableHeaderCell, styles.repsColumn]}>REPS</Text>
            <View style={styles.removeColumn} />
          </View>
          {exercise.sets.map((set, setIndex) => (
            <View key={setIndex} style={styles.setRow}>
              <Pressable
                onPress={() => updateSet(exerciseIndex, setIndex, { isFailureTarget: !set.isFailureTarget })}
                style={[styles.setColumn, styles.setBadge, set.isFailureTarget && styles.setBadgeFailure]}
                accessibilityRole="button"
              >
                <Text style={[styles.setBadgeText, set.isFailureTarget && styles.setBadgeTextFailure]}>
                  {set.isFailureTarget ? 'F' : setIndex + 1}
                </Text>
              </Pressable>
              <TextInput
                style={[styles.setInput, styles.weightColumn]}
                value={set.targetWeight}
                onChangeText={(t) => updateSet(exerciseIndex, setIndex, { targetWeight: t.replace(/[^0-9.]/g, '') })}
                keyboardType="decimal-pad"
                placeholder="—"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={[styles.setInput, styles.repsColumn]}
                value={set.targetReps}
                onChangeText={(t) => updateSet(exerciseIndex, setIndex, { targetReps: t.replace(/[^0-9]/g, '') })}
                keyboardType="numeric"
                placeholder="10"
                placeholderTextColor={colors.textMuted}
              />
              <Pressable
                onPress={() => removeSet(exerciseIndex, setIndex)}
                hitSlop={8}
                style={styles.removeColumn}
                accessibilityRole="button"
              >
                <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          <Button label="+ Agregar serie" variant="secondary" onPress={() => addSet(exerciseIndex)} />
        </View>
      ))}
      <Button label="+ Agregar ejercicio" onPress={() => setIsPickerOpen(true)} />
      <ExercisePickerModal
        visible={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelect={addExercise}
        excludeIds={values.map((v) => v.exerciseId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  exerciseCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  exerciseHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  exerciseName: { flex: 1, color: colors.primary, fontWeight: '700', fontSize: 16 },
  notesInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    color: colors.text,
    fontSize: 13,
    minHeight: 36,
  },
  restRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  restLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  restInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    color: colors.text,
    fontSize: 13,
    width: 44,
    textAlign: 'center',
  },
  restUnit: { color: colors.textMuted, fontSize: 12 },
  setsTableHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  tableHeaderCell: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  setColumn: { width: 34 },
  weightColumn: { flex: 1 },
  repsColumn: { flex: 1 },
  removeColumn: { width: 24, alignItems: 'center' },
  setBadge: {
    height: 28,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setBadgeFailure: { backgroundColor: 'rgba(255,107,107,0.15)' },
  setBadgeText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  setBadgeTextFailure: { color: colors.danger },
  setInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: 4,
    color: colors.text,
    fontSize: 14,
    textAlign: 'center',
  },
});
