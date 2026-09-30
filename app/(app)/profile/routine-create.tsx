import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TextField } from '@/components/ui/TextField';
import { RoutineExerciseListEditor, type RoutineExerciseFormRow } from '@/components/ui/RoutineExerciseListEditor';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useMyRoutines } from '@/hooks/useMyRoutines';
import { formRowsToRoutineInput, routineInputToArgs } from '@/lib/domain/routineForm';
import { routineSchema } from '@/lib/validation/schemas';
import { colors, spacing } from '@/constants/theme';

const SCOPE_OPTIONS: { key: 'personal' | 'group'; label: string }[] = [
  { key: 'personal', label: 'Personal' },
  { key: 'group', label: 'Compartir con el grupo' },
];

export default function CreateRoutineScreen() {
  const { profile } = useAuth();
  const { group } = useActiveGroup();
  const { createRoutine } = useMyRoutines(group?.id ?? null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'personal' | 'group'>('personal');
  const [exercises, setExercises] = useState<RoutineExerciseFormRow[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const unit = profile?.weight_unit ?? 'kg';

  const handleSubmit = async () => {
    const result = routineSchema.safeParse({
      name,
      groupId: scope === 'group' ? (group?.id ?? null) : null,
      exercises: formRowsToRoutineInput(exercises),
    });
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      await createRoutine(result.data.name, routineInputToArgs(result.data.exercises), result.data.groupId);
      router.back();
    } catch (err) {
      Alert.alert('No se pudo crear la rutina', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    // Replaces the old KeyboardAvoidingView + ScrollView pair — that combo
    // just shifted the whole screen up by the keyboard's height, which did
    // nothing for a field further down the list than that shift could
    // reach (the last exercise, reported bug). This scrolls the exact
    // focused field into view above the keyboard instead, and mode="insets"
    // (the default) keeps everything else visually stable — no reflow/jump
    // — while it does.
    <KeyboardAwareScrollView style={styles.flex} contentContainerStyle={styles.container} bottomOffset={spacing.lg} keyboardShouldPersistTaps="handled">
      <Card style={styles.card}>
        <TextField label="Nombre de la rutina" value={name} onChangeText={setName} placeholder="Día de pierna" />
        {group ? (
          <SegmentedControl options={SCOPE_OPTIONS} value={scope} onChange={setScope} />
        ) : (
          <Text style={styles.hint}>Entra a un grupo para poder compartir rutinas con él.</Text>
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Ejercicios</Text>
        <RoutineExerciseListEditor values={exercises} onChange={setExercises} defaultUnit={unit} />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Crear rutina" onPress={handleSubmit} loading={isSubmitting} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.md },
  sectionTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  hint: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13 },
});
