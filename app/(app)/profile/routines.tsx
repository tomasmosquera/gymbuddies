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

/** Same shape as Hevy's own routine card: name + "•••" (edit/borrar) up top, exercise summary, one full-width "Empezar". No card-body tap — editing only lives behind the "•••" now. */
function RoutineCard({
  routine,
  groupName,
  canStart,
  isStarting,
  isDeleting,
  onStart,
  onEdit,
  onDelete,
}: {
  routine: RoutineWithExercises;
  groupName: string | null;
  canStart: boolean;
  isStarting: boolean;
  isDeleting: boolean;
  onStart: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const openMenu = () => {
    Alert.alert(routine.name, undefined, [
      { text: 'Editar', onPress: onEdit },
      { text: 'Borrar', style: 'destructive', onPress: onDelete },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  return (
    <Card style={styles.routineCard}>
      <View style={styles.routineHeader}>
        <View style={styles.routineTitleWrap}>
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
        <Pressable onPress={openMenu} hitSlop={10} accessibilityRole="button" accessibilityLabel="Opciones de la rutina">
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <Text style={styles.exercisesSummary} numberOfLines={2}>
        {routine.exercises.map((e) => e.exercise.name).join(', ') || 'Sin ejercicios'}
      </Text>

      {canStart ? <Button label="Empezar" onPress={onStart} loading={isStarting} /> : null}
      {isDeleting ? <ActivityIndicator color={colors.danger} /> : null}
    </Card>
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

  const renderCard = (routine: RoutineWithExercises, groupName: string | null) => (
    <RoutineCard
      key={routine.id}
      routine={routine}
      groupName={groupName}
      canStart={!activeSession}
      isStarting={isStarting === routine.id}
      isDeleting={isDeleting === routine.id}
      onStart={() => handleStart(() => startFromRoutine(routine.id), routine.id)}
      onEdit={() => router.push({ pathname: '/profile/routine-edit', params: { routineId: routine.id } })}
      onDelete={() => confirmDelete(routine)}
    />
  );

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
          personalRoutines.map((routine) => renderCard(routine, null))
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
            groupRoutines.map((routine) => renderCard(routine, group.name))
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
  routineCard: { gap: spacing.sm, marginBottom: spacing.sm },
  routineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  routineTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
