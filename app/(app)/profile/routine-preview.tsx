import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useAuth } from '@/hooks/useAuth';
import { useMyRoutines } from '@/hooks/useMyRoutines';
import { useOfficialRoutines, type OfficialRoutine } from '@/hooks/useOfficialRoutines';
import { formatDuration } from '@/lib/domain/workoutSession';
import { formatWeightUnit } from '@/lib/domain/workoutUnits';
import { ROUTINE_EQUIPMENT_LABELS, ROUTINE_GOAL_LABELS, ROUTINE_LEVEL_LABELS } from '@/lib/domain/routineFilters';
import type { RoutineExerciseWithDetails } from '@/hooks/useMyRoutines';
import type { WeightUnit } from '@/lib/domain/workoutUnits';
import { colors, spacing, typography } from '@/constants/theme';

/** "8-12 reps" or "10 reps" when the range is a single number, plus the target weight (in the
 * viewer's own unit) when the exercise has one — these are a plan, never what gets logged. */
function formatTargetSet(
  set: { target_reps_min: number; target_reps_max: number; target_weight_kg: number | null; is_failure_target: boolean },
  unit: WeightUnit
): string {
  const reps = set.target_reps_min === set.target_reps_max ? `${set.target_reps_min}` : `${set.target_reps_min}-${set.target_reps_max}`;
  const weight = set.target_weight_kg !== null ? `${formatWeightUnit(set.target_weight_kg, unit)} ${unit} × ` : '';
  const failure = set.is_failure_target ? ' (al fallo)' : '';
  return `${weight}${reps} reps${failure}`;
}

function ExerciseBlock({ exercise, unit }: { exercise: RoutineExerciseWithDetails; unit: WeightUnit }) {
  return (
    <Card style={styles.exerciseCard}>
      <View style={styles.exerciseHeader}>
        <Text style={styles.exerciseName}>{exercise.exercise.name}</Text>
        {exercise.rest_seconds ? <Text style={styles.restText}>Descanso: {formatDuration(exercise.rest_seconds)}</Text> : null}
      </View>
      {exercise.notes ? <Text style={styles.exerciseNotes}>{exercise.notes}</Text> : null}
      {exercise.sets.map((set) => (
        <Text key={set.id} style={styles.setLine}>
          Serie {set.set_number}: {formatTargetSet(set, unit)}
        </Text>
      ))}
    </Card>
  );
}

/** Tapped from Explorar rutinas (either a standalone routine or one day inside a program) — full
 * read-only detail (exercises, sets, reps, rest) before deciding to copy. Copying still reuses
 * useMyRoutines' existing copyRoutine, same as the old inline button on the browse list did. */
export default function RoutinePreviewScreen() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  const { profile } = useAuth();
  const { group } = useActiveGroup();
  const { routines, isLoading } = useOfficialRoutines();
  const { copyRoutine } = useMyRoutines(group?.id ?? null);
  const [isCopying, setIsCopying] = useState(false);
  const unit = profile?.weight_unit ?? 'kg';

  const routine: OfficialRoutine | undefined = routines.find((r) => r.id === routineId);

  const handleCopy = async () => {
    if (!routine) return;
    setIsCopying(true);
    try {
      await copyRoutine(routine, null);
      Alert.alert('Copiada', `"${routine.name}" se copió a Mis Rutinas.`);
    } catch (err) {
      Alert.alert('No se pudo copiar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsCopying(false);
    }
  };

  if (isLoading || !routine) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{routine.name}</Text>
      <View style={styles.badgeRow}>
        {routine.level ? <Badge label={ROUTINE_LEVEL_LABELS[routine.level]} /> : null}
        {routine.goal ? <Badge label={ROUTINE_GOAL_LABELS[routine.goal]} /> : null}
        <Badge label={ROUTINE_EQUIPMENT_LABELS[routine.equipmentProfile]} />
        {routine.days_per_week ? <Badge label={`${routine.days_per_week} días/semana`} /> : null}
      </View>

      {routine.exercises.map((exercise) => (
        <ExerciseBlock key={exercise.id} exercise={exercise} unit={unit} />
      ))}

      {isCopying ? <ActivityIndicator color={colors.primary} /> : <Button label="Copiar a mis rutinas" onPress={handleCopy} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  title: { ...typography.heading, fontSize: 20, color: colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  exerciseCard: { gap: 4 },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  exerciseName: { ...typography.heading, fontSize: 15, color: colors.text, flexShrink: 1 },
  restText: { color: colors.textMuted, fontSize: 12 },
  exerciseNotes: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  setLine: { color: colors.textMuted, fontSize: 13 },
});
