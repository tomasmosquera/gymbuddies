import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { ExercisePickerModal } from '@/components/ui/ExercisePickerModal';
import { colors, radii, spacing } from '@/constants/theme';
import type { WeightUnit } from '@/lib/domain/workoutUnits';
import type { Exercise } from '@/lib/supabase/types';

/** One row of the routine editor — raw strings while editing, same reason MoneyField/PrizeSplitEditor keep numeric fields as text (never flash NaN). */
export interface RoutineExerciseFormRow {
  exerciseId: string;
  exerciseName: string;
  targetSets: string;
  targetReps: string;
  targetWeight: string;
}

interface RoutineExerciseListEditorProps {
  values: RoutineExerciseFormRow[];
  onChange: (values: RoutineExerciseFormRow[]) => void;
  unit: WeightUnit;
}

export function exerciseToFormRow(exercise: Exercise): RoutineExerciseFormRow {
  return { exerciseId: exercise.id, exerciseName: exercise.name, targetSets: '3', targetReps: '10', targetWeight: '' };
}

/** The list of exercises inside a routine being created/edited — add from the catalog, set a target sets/reps/weight per exercise, reorder by removing and re-adding, or remove. */
export function RoutineExerciseListEditor({ values, onChange, unit }: RoutineExerciseListEditorProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const updateAt = (index: number, patch: Partial<RoutineExerciseFormRow>) => {
    onChange(values.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };
  const removeAt = (index: number) => onChange(values.filter((_, i) => i !== index));
  const addExercise = (exercise: Exercise) => onChange([...values, exerciseToFormRow(exercise)]);

  return (
    <View style={styles.container}>
      {values.map((row, index) => (
        <View key={row.exerciseId} style={styles.row}>
          <View style={styles.rowHeader}>
            <Text style={styles.exerciseName} numberOfLines={1}>
              {index + 1}. {row.exerciseName}
            </Text>
            <Pressable onPress={() => removeAt(index)} hitSlop={8} accessibilityRole="button">
              <Ionicons name="close-circle" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.targetsRow}>
            <View style={styles.targetField}>
              <Text style={styles.targetLabel}>Series</Text>
              <TextInput
                style={styles.targetInput}
                value={row.targetSets}
                onChangeText={(t) => updateAt(index, { targetSets: t.replace(/[^0-9]/g, '') })}
                keyboardType="numeric"
                placeholder="3"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.targetField}>
              <Text style={styles.targetLabel}>Reps</Text>
              <TextInput
                style={styles.targetInput}
                value={row.targetReps}
                onChangeText={(t) => updateAt(index, { targetReps: t.replace(/[^0-9]/g, '') })}
                keyboardType="numeric"
                placeholder="10"
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.targetField}>
              <Text style={styles.targetLabel}>Peso ({unit})</Text>
              <TextInput
                style={styles.targetInput}
                value={row.targetWeight}
                onChangeText={(t) => updateAt(index, { targetWeight: t.replace(/[^0-9.]/g, '') })}
                keyboardType="decimal-pad"
                placeholder="Opcional"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>
        </View>
      ))}
      <Button label="+ Agregar ejercicio" variant="secondary" onPress={() => setIsPickerOpen(true)} />
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
  container: { gap: spacing.sm },
  row: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  exerciseName: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 15 },
  targetsRow: { flexDirection: 'row', gap: spacing.sm },
  targetField: { flex: 1, gap: 2 },
  targetLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  targetInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    color: colors.text,
    fontSize: 14,
  },
});
