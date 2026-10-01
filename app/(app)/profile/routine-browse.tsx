import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useMyRoutines } from '@/hooks/useMyRoutines';
import { useOfficialRoutines, type OfficialRoutine } from '@/hooks/useOfficialRoutines';
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

function OfficialRoutineCard({
  routine,
  isCopying,
  onCopy,
}: {
  routine: OfficialRoutine;
  isCopying: boolean;
  onCopy: () => void;
}) {
  return (
    <Card style={styles.routineCard}>
      <Text style={styles.routineName}>{routine.name}</Text>
      <View style={styles.badgeRow}>
        {routine.level ? <Badge label={ROUTINE_LEVEL_LABELS[routine.level]} /> : null}
        {routine.goal ? <Badge label={ROUTINE_GOAL_LABELS[routine.goal]} /> : null}
        <Badge label={ROUTINE_EQUIPMENT_LABELS[routine.equipmentProfile]} />
        {routine.days_per_week ? <Badge label={`${routine.days_per_week} días/semana`} /> : null}
      </View>
      <Text style={styles.exercisesSummary} numberOfLines={2}>
        {routine.exercises.map((e) => e.exercise.name).join(', ')}
      </Text>
      {isCopying ? <ActivityIndicator color={colors.primary} /> : <Button label="Copiar a mis rutinas" variant="secondary" onPress={onCopy} />}
    </Card>
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
 * Rutinas"/"Rutinas de {grupo}" on routines.tsx. Copying one reuses useMyRoutines' own copyRoutine
 * (same RPC a member already uses to copy a group-mate's shared routine) — always into "Mis
 * Rutinas" (targetGroupId null), never straight into a group, since these aren't the active
 * group's own routines to begin with. */
export default function RoutineBrowseScreen() {
  const { group } = useActiveGroup();
  const { routines, isLoading } = useOfficialRoutines();
  const { copyRoutine } = useMyRoutines(group?.id ?? null);
  const [filters, setFilters] = useState<RoutineFilterState>(EMPTY_ROUTINE_FILTERS);
  const [isCopying, setIsCopying] = useState<string | null>(null);

  const filtered = useMemo(() => routines.filter((r) => matchesRoutineFilters(r, filters)), [routines, filters]);

  const handleCopy = async (routine: OfficialRoutine) => {
    setIsCopying(routine.id);
    try {
      await copyRoutine(routine, null);
      Alert.alert('Copiada', `"${routine.name}" se copió a Mis Rutinas.`);
    } catch (err) {
      Alert.alert('No se pudo copiar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsCopying(null);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.hint}>Rutinas armadas por Gym Buddies. Copia la que quieras a Mis Rutinas y empezala cuando entrenes.</Text>

      <FilterGroup label="NIVEL" options={LEVEL_OPTIONS} value={filters.level} onChange={(level) => setFilters((f) => ({ ...f, level }))} />
      <FilterGroup label="OBJETIVO" options={GOAL_OPTIONS} value={filters.goal} onChange={(goal) => setFilters((f) => ({ ...f, goal }))} />
      <FilterGroup
        label="EQUIPO"
        options={EQUIPMENT_OPTIONS}
        value={filters.equipment}
        onChange={(equipment) => setFilters((f) => ({ ...f, equipment }))}
      />

      {filtered.length === 0 ? (
        <EmptyState title="Ninguna rutina coincide" description="Probá sacando algún filtro." />
      ) : (
        filtered.map((routine) => (
          <OfficialRoutineCard key={routine.id} routine={routine} isCopying={isCopying === routine.id} onCopy={() => handleCopy(routine)} />
        ))
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
});
