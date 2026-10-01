import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useOfficialRoutines, type OfficialRoutine } from '@/hooks/useOfficialRoutines';
import { groupRoutinesByProgram } from '@/lib/domain/routinePrograms';
import {
  EMPTY_ROUTINE_FILTERS,
  matchesRoutineFilters,
  ROUTINE_EQUIPMENT_LABELS,
  ROUTINE_GOAL_LABELS,
  ROUTINE_LEVEL_LABELS,
  type RoutineEquipmentProfile,
  type RoutineFilterState,
} from '@/lib/domain/routineFilters';
import type { RoutineGoal, RoutineLevel } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

/** One filter group — "Todos" (value null) plus every option, as a horizontally wrapping row of pills. */
function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.pillRow}>
        <Pressable onPress={() => onChange(null)} style={[styles.pill, value === null && styles.pillActive]}>
          <Text style={[styles.pillText, value === null && styles.pillTextActive]}>Todos</Text>
        </Pressable>
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => onChange(value === opt.value ? null : opt.value)}
            style={[styles.pill, value === opt.value && styles.pillActive]}
          >
            <Text style={[styles.pillText, value === opt.value && styles.pillTextActive]}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RoutineBadgeRow({ routine }: { routine: OfficialRoutine }) {
  return (
    <View style={styles.badgeRow}>
      {routine.level ? <Badge label={ROUTINE_LEVEL_LABELS[routine.level]} /> : null}
      {routine.goal ? <Badge label={ROUTINE_GOAL_LABELS[routine.goal]} /> : null}
      <Badge label={ROUTINE_EQUIPMENT_LABELS[routine.equipmentProfile]} />
      {routine.days_per_week ? <Badge label={`${routine.days_per_week} días/semana`} /> : null}
    </View>
  );
}

const openPreview = (routineId: string) => router.push({ pathname: '/profile/routine-preview', params: { routineId } });

/** A program's days, one tappable row per day (its own exercises/sets live behind the tap, in
 * routine-preview.tsx) — badges shown once up top since every day of a program in practice shares
 * the same level/goal/equipment (they're the same training split). */
function ProgramCard({ programName, routines }: { programName: string; routines: OfficialRoutine[] }) {
  return (
    <Card style={styles.routineCard}>
      <Text style={styles.routineName}>{programName}</Text>
      <RoutineBadgeRow routine={routines[0]} />
      {routines.map((routine) => (
        <Pressable key={routine.id} onPress={() => openPreview(routine.id)} style={styles.dayRow} accessibilityRole="button">
          <Text style={styles.dayLabel}>{routine.day_label ?? routine.name}</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ))}
    </Card>
  );
}

function StandaloneRoutineCard({ routine }: { routine: OfficialRoutine }) {
  return (
    <Pressable onPress={() => openPreview(routine.id)} accessibilityRole="button">
      <Card style={styles.routineCard}>
        <Text style={styles.routineName}>{routine.name}</Text>
        <RoutineBadgeRow routine={routine} />
        <Text style={styles.exercisesSummary} numberOfLines={2}>
          {routine.exercises.map((e) => e.exercise.name).join(', ')}
        </Text>
      </Card>
    </Pressable>
  );
}

const LEVEL_OPTIONS: { value: RoutineLevel; label: string }[] = [
  { value: 'principiante', label: ROUTINE_LEVEL_LABELS.principiante },
  { value: 'intermedio', label: ROUTINE_LEVEL_LABELS.intermedio },
  { value: 'avanzado', label: ROUTINE_LEVEL_LABELS.avanzado },
];
const GOAL_OPTIONS: { value: RoutineGoal; label: string }[] = [
  { value: 'fuerza', label: ROUTINE_GOAL_LABELS.fuerza },
  { value: 'hipertrofia', label: ROUTINE_GOAL_LABELS.hipertrofia },
  { value: 'perdida_grasa', label: ROUTINE_GOAL_LABELS.perdida_grasa },
  { value: 'general', label: ROUTINE_GOAL_LABELS.general },
];
const EQUIPMENT_OPTIONS: { value: RoutineEquipmentProfile; label: string }[] = [
  { value: 'sin_equipo', label: ROUTINE_EQUIPMENT_LABELS.sin_equipo },
  { value: 'mancuernas', label: ROUTINE_EQUIPMENT_LABELS.mancuernas },
  { value: 'gimnasio', label: ROUTINE_EQUIPMENT_LABELS.gimnasio },
];

/** "Explorar rutinas" — Gym Buddies' own curated routines, reachable from the button below "Mis
 * Rutinas"/"Rutinas de {grupo}" on routines.tsx. Routines that are really days of the same program
 * (StrongLifts 5x5, Push Pull Legs, Upper Lower) are grouped under one card; tapping any routine —
 * standalone or a day inside a program — opens routine-preview.tsx for the full exercise/set detail
 * and the "Copiar a mis rutinas" action, rather than copying straight from this list. */
export default function RoutineBrowseScreen() {
  const { routines, isLoading } = useOfficialRoutines();
  const [filters, setFilters] = useState<RoutineFilterState>(EMPTY_ROUTINE_FILTERS);

  const groups = useMemo(() => {
    const filtered = routines.filter((r) => matchesRoutineFilters(r, filters));
    return groupRoutinesByProgram(filtered);
  }, [routines, filters]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.hint}>Rutinas armadas por Gym Buddies. Tocá una para ver el detalle y copiarla a Mis Rutinas.</Text>

      <FilterGroup label="NIVEL" options={LEVEL_OPTIONS} value={filters.level} onChange={(level) => setFilters((f) => ({ ...f, level }))} />
      <FilterGroup label="OBJETIVO" options={GOAL_OPTIONS} value={filters.goal} onChange={(goal) => setFilters((f) => ({ ...f, goal }))} />
      <FilterGroup
        label="EQUIPO"
        options={EQUIPMENT_OPTIONS}
        value={filters.equipment}
        onChange={(equipment) => setFilters((f) => ({ ...f, equipment }))}
      />

      {groups.length === 0 ? (
        <EmptyState title="Ninguna rutina coincide" description="Probá sacando algún filtro." />
      ) : (
        groups.map((g) =>
          g.programName ? (
            <ProgramCard key={g.programName} programName={g.programName} routines={g.routines} />
          ) : (
            <StandaloneRoutineCard key={g.routines[0].id} routine={g.routines[0]} />
          )
        )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  filterGroup: { gap: spacing.xs },
  filterLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: colors.primaryText },
  routineCard: { gap: spacing.sm },
  routineName: { ...typography.heading, fontSize: 16, color: colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  exercisesSummary: { color: colors.textMuted, fontSize: 13 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dayLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
