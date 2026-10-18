import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MuscleDiagram } from '@/components/ui/MuscleDiagram';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useMyRoutines, type RoutineExerciseWithDetails } from '@/hooks/useMyRoutines';
import { useWorkoutSession } from '@/hooks/useWorkoutSession';
import { formatDuration } from '@/lib/domain/workoutSession';
import { colors, spacing, typography } from '@/constants/theme';

function ExerciseRow({ exercise }: { exercise: RoutineExerciseWithDetails }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/profile/exercise-detail', params: { exerciseId: exercise.exercise.id } })}
      style={styles.exerciseRow}
      accessibilityRole="button"
    >
      <View style={styles.flex}>
        <Text style={styles.exerciseName}>{exercise.exercise.name}</Text>
        <Text style={styles.exerciseMeta}>
          {exercise.sets.length} series
          {exercise.rest_seconds ? ` · Descanso ${formatDuration(exercise.rest_seconds)}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/** Tapped from the routine card body in routines.tsx (not "Empezar" or "•••") — a read-only look
 * at what's actually inside the routine before committing to it: which exercises, what muscles
 * they hit (via MuscleDiagram, aggregating every exercise's primary muscle_group), and a tap into
 * each exercise's own detail. "Empezar" here reuses the exact same startFromRoutine flow as the
 * routines list itself. */
export default function RoutineViewScreen() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  const { group } = useActiveGroup();
  const { routines, isLoading } = useMyRoutines(group?.id ?? null);
  const { session: activeSession, startFromRoutine } = useWorkoutSession();
  const [isStarting, setIsStarting] = useState(false);

  const routine = routines.find((r) => r.id === routineId);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await startFromRoutine(routineId);
      router.push('/profile/workout-session');
    } catch (err) {
      Alert.alert('No se pudo empezar el entreno', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsStarting(false);
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

      <MuscleDiagram muscleGroups={routine.exercises.map((e) => e.exercise.muscle_group)} />

      <Card style={styles.exercisesCard}>
        {routine.exercises.map((exercise, i) => (
          <View key={exercise.id}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <ExerciseRow exercise={exercise} />
          </View>
        ))}
      </Card>

      {!activeSession ? <Button label="Empezar" onPress={handleStart} loading={isStarting} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  title: { ...typography.heading, fontSize: 20, color: colors.text },
  exercisesCard: { gap: 0, padding: 0, overflow: 'hidden' },
  exerciseRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  exerciseName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  exerciseMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md },
});
