import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useMyRoutines, type RoutineWithExercises } from '@/hooks/useMyRoutines';
import { useWorkoutSession } from '@/hooks/useWorkoutSession';
import { colors, radii, spacing, typography } from '@/constants/theme';

function RoutineCard({ routine, groupName, onPress }: { routine: RoutineWithExercises; groupName: string | null; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={styles.routineCard}>
        <View style={styles.routineHeader}>
          <Text style={styles.routineName} numberOfLines={1}>
            {routine.name}
          </Text>
          {routine.group_id ? (
            <View style={styles.groupPill}>
              <Ionicons name="people" size={12} color={colors.primary} />
              <Text style={styles.groupPillText} numberOfLines={1}>
                {groupName ?? 'Grupo'}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.exercisesSummary} numberOfLines={2}>
          {routine.exercises.map((e) => e.exercise.name).join(' · ') || 'Sin ejercicios'}
        </Text>
      </Card>
    </Pressable>
  );
}

/**
 * Fase 1/2's temporary home — reachable from Perfil → Configuración while
 * this feature is being built and reviewed. Where it really lives in the
 * navigation (its own tab? nested somewhere else?) is a later decision (Fase 5).
 */
export default function RoutinesScreen() {
  const { group } = useActiveGroup();
  const { routines, isLoading, refresh, deleteRoutine } = useMyRoutines(group?.id ?? null);
  const { session: activeSession, isLoading: isSessionLoading, startFromRoutine, startFreeform, refresh: refreshSession } = useWorkoutSession();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshSession();
    }, [refresh, refreshSession])
  );

  const confirmDelete = (routine: RoutineWithExercises) => {
    Alert.alert(
      'Borrar rutina',
      `¿Borrar "${routine.name}"? Los entrenos que ya registraste con ella no se pierden.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(routine.id);
            try {
              await deleteRoutine(routine.id);
            } catch (err) {
              Alert.alert('No se pudo borrar', err instanceof Error ? err.message : 'Intenta de nuevo');
            } finally {
              setIsDeleting(null);
            }
          },
        },
      ]
    );
  };

  const handleStart = async (starter: () => Promise<void>, key: string) => {
    setIsStarting(key);
    try {
      await starter();
      router.push('/profile/workout-session');
    } catch (err) {
      Alert.alert('No se pudo empezar el entreno', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsStarting(null);
    }
  };

  if (isLoading || isSessionLoading) {
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
      <Text style={styles.hint}>
        Arma tus rutinas con ejercicios del catálogo — series, repeticiones y peso objetivo por ejercicio. Todavía no
        están conectadas al check-in; por ahora se empiezan desde aquí.
      </Text>

      {activeSession ? (
        <Pressable onPress={() => router.push('/profile/workout-session')} accessibilityRole="button">
          <Card style={styles.activeBanner}>
            <Ionicons name="barbell" size={20} color={colors.primaryText} />
            <View style={styles.flex}>
              <Text style={styles.activeBannerTitle}>Entreno en curso</Text>
              <Text style={styles.activeBannerSubtitle} numberOfLines={1}>
                {activeSession.routine_name_snapshot ?? 'Entreno libre'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.primaryText} />
          </Card>
        </Pressable>
      ) : (
        <Button
          label="Empezar entreno libre"
          variant="secondary"
          onPress={() => handleStart(() => startFreeform(), 'freeform')}
          loading={isStarting === 'freeform'}
        />
      )}

      <Button label="+ Crear rutina" onPress={() => router.push('/profile/routine-create')} />

      <View>
        <Text style={styles.sectionLabel}>MIS RUTINAS</Text>
        {personalRoutines.length === 0 ? (
          <EmptyState title="Sin rutinas propias" description="Crea tu primera rutina con el botón de arriba." />
        ) : (
          personalRoutines.map((routine) => (
            <View key={routine.id} style={styles.cardWrap}>
              <RoutineCard
                routine={routine}
                groupName={null}
                onPress={() => router.push({ pathname: '/profile/routine-edit', params: { routineId: routine.id } })}
              />
              <View style={styles.actionsRow}>
                {!activeSession ? (
                  <Button
                    label="Empezar"
                    onPress={() => handleStart(() => startFromRoutine(routine.id), routine.id)}
                    loading={isStarting === routine.id}
                  />
                ) : null}
                <Button
                  label="Borrar"
                  variant="danger"
                  onPress={() => confirmDelete(routine)}
                  loading={isDeleting === routine.id}
                />
              </View>
            </View>
          ))
        )}
      </View>

      {group ? (
        <View>
          <Text style={styles.sectionLabel}>RUTINAS DE {group.name.toUpperCase()}</Text>
          {groupRoutines.length === 0 ? (
            <EmptyState
              title="Sin rutinas de grupo"
              description="Cualquier miembro puede crear una rutina y compartirla con este grupo."
            />
          ) : (
            groupRoutines.map((routine) => (
              <View key={routine.id} style={styles.cardWrap}>
                <RoutineCard
                  routine={routine}
                  groupName={group.name}
                  onPress={() => router.push({ pathname: '/profile/routine-edit', params: { routineId: routine.id } })}
                />
                <View style={styles.actionsRow}>
                  {!activeSession ? (
                    <Button
                      label="Empezar"
                      onPress={() => handleStart(() => startFromRoutine(routine.id), routine.id)}
                      loading={isStarting === routine.id}
                    />
                  ) : null}
                  <Button
                    label="Borrar"
                    variant="danger"
                    onPress={() => confirmDelete(routine)}
                    loading={isDeleting === routine.id}
                  />
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  activeBannerTitle: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
  activeBannerSubtitle: { color: colors.primaryText, fontSize: 13 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  cardWrap: { gap: spacing.xs, marginBottom: spacing.sm },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  routineCard: { gap: spacing.xs },
  routineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  routineName: { ...typography.heading, fontSize: 16, color: colors.text, flexShrink: 1 },
  groupPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(61, 220, 151, 0.12)',
    maxWidth: 140,
  },
  groupPillText: { color: colors.primary, fontSize: 11, fontWeight: '600' },
  exercisesSummary: { color: colors.textMuted, fontSize: 13 },
});
