import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { RoutineExerciseListEditor, type RoutineExerciseFormRow } from '@/components/ui/RoutineExerciseListEditor';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useMyRoutines } from '@/hooks/useMyRoutines';
import { formRowsToRoutineInput, routineExerciseToFormRow, routineInputToArgs } from '@/lib/domain/routineForm';
import { routineSchema } from '@/lib/validation/schemas';
import { colors, spacing } from '@/constants/theme';

export default function EditRoutineScreen() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  const { profile } = useAuth();
  const { group } = useActiveGroup();
  const { routines, isLoading, updateRoutine } = useMyRoutines(group?.id ?? null);
  const routine = routines.find((r) => r.id === routineId) ?? null;
  const unit = profile?.weight_unit ?? 'kg';

  const [name, setName] = useState('');
  const [exercises, setExercises] = useState<RoutineExerciseFormRow[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Only seeds the form once the routine actually loads — refetching from
  // useMyRoutines after saving shouldn't stomp on further edits in progress.
  useEffect(() => {
    if (routine && !isInitialized) {
      setName(routine.name);
      setExercises(
        routine.exercises.map((e) =>
          routineExerciseToFormRow(
            { exercise_id: e.exercise_id, exercise_name: e.exercise.name, rest_seconds: e.rest_seconds, notes: e.notes, sets: e.sets },
            unit
          )
        )
      );
      setIsInitialized(true);
    }
  }, [routine, isInitialized, unit]);

  const handleSubmit = async () => {
    if (!routine) return;
    const result = routineSchema.safeParse({ name, groupId: routine.group_id, exercises: formRowsToRoutineInput(exercises) });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      await updateRoutine(routine.id, result.data.name, routineInputToArgs(result.data.exercises));
      router.back();
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !isInitialized) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!routine) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Esta rutina ya no existe.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <TextField label="Nombre de la rutina" value={name} onChangeText={setName} placeholder="Día de pierna" />
          <Text style={styles.hint}>
            {routine.group_id ? 'Compartida con el grupo.' : 'Personal.'} Esto no se puede cambiar después de crearla.
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Ejercicios</Text>
          <RoutineExerciseListEditor values={exercises} onChange={setExercises} defaultUnit={unit} />
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Guardar cambios" onPress={handleSubmit} loading={isSubmitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.md },
  sectionTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  hint: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13 },
});
