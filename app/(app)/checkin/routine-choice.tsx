import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useMyRoutines, type RoutineWithExercises } from '@/hooks/useMyRoutines';
import { useWorkoutSession } from '@/hooks/useWorkoutSession';
import { replaceThenCrossTabPush } from '@/lib/navigation';
import { colors, spacing, typography } from '@/constants/theme';

/** One tappable routine — same summary line as Rutinas' own card, no "···" menu here (this screen only starts a routine, never edits one). */
function RoutineOption({ routine, isStarting, onPress }: { routine: RoutineWithExercises; isStarting: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={isStarting} accessibilityRole="button">
      <Card style={styles.routineCard}>
        <View style={styles.routineRow}>
          <View style={styles.flex}>
            <Text style={styles.routineName} numberOfLines={1}>
              {routine.name}
            </Text>
            <Text style={styles.routineSummary} numberOfLines={1}>
              {routine.exercises.map((e) => e.exercise.name).join(', ') || 'Sin ejercicios'}
            </Text>
          </View>
          {isStarting ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * Fase 3: the "¿qué vas a entrenar?" step right after a successful check-in
 * (checkin/preview.tsx redirects here instead of straight to /home) — never
 * shown for a checkout. start_workout_session already takes an optional
 * p_checkin_id (migration 0127); this is simply its first caller that
 * actually passes one, linking the session to today's check-in.
 *
 * Three ways out, no plain "skip" option anymore (that's what "Entreno
 * Libre" IS now — see handleMarkTrainedOnly):
 *   - a routine (Mis Rutinas + the active group's own)
 *   - "Elegir ejercicios": starts empty, live-logs from the catalog
 *     (app/(app)/profile/workout-session.tsx)
 *   - "Entreno Libre": no exercise detail at all, just marks a workout
 *     happened and goes straight to the checkout prompt
 *
 * If a session is somehow already in_progress (e.g. abandoned yesterday),
 * starting a "new" one would just silently resume that old one instead —
 * confusing after picking a specific routine here — so this screen skips
 * straight to resuming it instead of offering a choice that wouldn't do
 * what it visibly says.
 */
export default function CheckinRoutineChoiceScreen() {
  const { checkinId } = useLocalSearchParams<{ checkinId: string }>();
  const { group, isLoading: isGroupLoading } = useActiveGroup();
  const { routines, isLoading: isRoutinesLoading } = useMyRoutines(group?.id ?? null);
  const { session: activeSession, isLoading: isSessionLoading, startFromRoutine, startFreeform, finish } = useWorkoutSession();
  const [startingKey, setStartingKey] = useState<string | null>(null);

  // Confirmed this screen DOES have a stuck-forever risk if left dangling
  // in the checkin tab's own history (reported: revisiting it via the back
  // button showed a spinner that never resolved) — see replaceThenCrossTabPush.
  const goToWorkoutSession = () => {
    replaceThenCrossTabPush('/checkin', '/profile/workout-session');
  };

  useEffect(() => {
    if (!isSessionLoading && activeSession) {
      goToWorkoutSession();
    }
  }, [isSessionLoading, activeSession]);

  const handleStart = async (starter: () => Promise<unknown>, key: string) => {
    setStartingKey(key);
    try {
      await starter();
      goToWorkoutSession();
    } catch (err) {
      Alert.alert('No se pudo empezar el entreno', err instanceof Error ? err.message : 'Intenta de nuevo');
      setStartingKey(null);
    }
  };

  // "Entreno libre" here means the opposite of "Elegir ejercicios" below —
  // no exercise detail at all, not even the catalog-driven live-logging
  // screen. Just marks that a workout happened (counts for streaks/checkout)
  // and starts+finishes the session in one step, then goes straight to the
  // checkout prompt — same destination "Terminar" already routes to. Same
  // tab as this screen (checkin), so a plain replace is enough — no
  // dangling-screen risk to guard against here.
  const handleMarkTrainedOnly = async () => {
    setStartingKey('mark-only');
    try {
      const newSession = await startFreeform(checkinId);
      await finish(newSession.id);
      router.replace('/checkin');
    } catch (err) {
      Alert.alert('No se pudo registrar el entreno', err instanceof Error ? err.message : 'Intenta de nuevo');
      setStartingKey(null);
    }
  };

  if (isGroupLoading || isRoutinesLoading || isSessionLoading || activeSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const personalRoutines = routines.filter((r) => !r.group_id);
  const groupRoutines = routines.filter((r) => r.group_id);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>¿Qué vas a entrenar hoy?</Text>
      <Text style={styles.hint}>Elige una rutina, elige ejercicios sueltos, o marca que entrenaste sin más detalle.</Text>

      <Button
        label="Elegir ejercicios"
        onPress={() => handleStart(() => startFreeform(checkinId), 'freeform')}
        loading={startingKey === 'freeform'}
        disabled={startingKey !== null && startingKey !== 'freeform'}
      />
      <Button
        label="Entreno Libre"
        variant="secondary"
        onPress={handleMarkTrainedOnly}
        loading={startingKey === 'mark-only'}
        disabled={startingKey !== null && startingKey !== 'mark-only'}
      />

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>MIS RUTINAS</Text>
        {personalRoutines.length === 0 ? (
          <EmptyState title="Sin rutinas propias" description="Créalas desde Perfil → Rutinas de entreno." />
        ) : (
          personalRoutines.map((routine) => (
            <RoutineOption
              key={routine.id}
              routine={routine}
              isStarting={startingKey === routine.id}
              onPress={() => handleStart(() => startFromRoutine(routine.id, checkinId), routine.id)}
            />
          ))
        )}
      </View>

      {group ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>RUTINAS DE {group.name.toUpperCase()}</Text>
          {groupRoutines.length === 0 ? (
            <EmptyState title="Sin rutinas de grupo" description="Cualquier miembro puede crear una y compartirla con este grupo." />
          ) : (
            groupRoutines.map((routine) => (
              <RoutineOption
                key={routine.id}
                routine={routine}
                isStarting={startingKey === routine.id}
                onPress={() => handleStart(() => startFromRoutine(routine.id, checkinId), routine.id)}
              />
            ))
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  flex: { flex: 1 },
  title: { ...typography.title, fontSize: 22, color: colors.text },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  section: { marginTop: spacing.sm },
  sectionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.sm },
  routineCard: { marginBottom: spacing.sm },
  routineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routineName: { ...typography.heading, fontSize: 15, color: colors.text },
  routineSummary: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
