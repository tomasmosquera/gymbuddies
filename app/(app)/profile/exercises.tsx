import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { EQUIPMENT_LABELS, EQUIPMENT_ORDER } from '@/constants/equipment';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_ORDER } from '@/constants/muscleGroups';
import { useExerciseCatalog } from '@/hooks/useExerciseCatalog';
import { colors, radii, spacing } from '@/constants/theme';
import type { Equipment, Exercise, MuscleGroup } from '@/lib/supabase/types';

type MuscleFilter = MuscleGroup | 'all';
type EquipmentFilter = Equipment | 'all';

function FilterChip({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, isActive && styles.chipActive]} accessibilityRole="button">
      <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Perfil → Rutinas → Ejercicios: browse the whole catalog (same search +
 * muscle/equipment filters as ExercisePickerModal, but as its own screen —
 * this one is for looking things up, not picking one for a routine). Tapping
 * a row goes straight to exercise-detail.tsx's Resumen/Histórico/Grupo/
 * Explicación tabs.
 */
export default function ExercisesScreen() {
  const { exercises } = useExerciseCatalog();
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<MuscleFilter>('all');
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentFilter>('all');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = exercises.filter(
      (e) =>
        (!q || e.name.toLowerCase().includes(q)) &&
        (muscleFilter === 'all' || e.muscle_group === muscleFilter) &&
        (equipmentFilter === 'all' || e.equipment === equipmentFilter)
    );
    const byGroup = new Map<string, Exercise[]>();
    for (const exercise of filtered) {
      const list = byGroup.get(exercise.muscle_group) ?? [];
      list.push(exercise);
      byGroup.set(exercise.muscle_group, list);
    }
    return MUSCLE_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      title: MUSCLE_GROUP_LABELS[g],
      data: byGroup.get(g)!,
    }));
  }, [exercises, query, muscleFilter, equipmentFilter]);

  return (
    <View style={styles.container}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar ejercicio..."
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        autoCorrect={false}
      />

      <Text style={styles.filterLabel}>Músculo</Text>
      <View style={styles.chipRowWrap}>
        <FilterChipRow
          options={[{ key: 'all', label: 'Todos' }, ...MUSCLE_GROUP_ORDER.map((g) => ({ key: g, label: MUSCLE_GROUP_LABELS[g] }))]}
          value={muscleFilter}
          onChange={(v) => setMuscleFilter(v as MuscleFilter)}
        />
      </View>

      <Text style={styles.filterLabel}>Equipo</Text>
      <View style={styles.chipRowWrap}>
        <FilterChipRow
          options={[{ key: 'all', label: 'Todos' }, ...EQUIPMENT_ORDER.map((eq) => ({ key: eq, label: EQUIPMENT_LABELS[eq] }))]}
          value={equipmentFilter}
          onChange={(v) => setEquipmentFilter(v as EquipmentFilter)}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/profile/exercise-detail', params: { exerciseId: item.id } })}
            style={styles.row}
            accessibilityRole="button"
          >
            {item.gif_url ? (
              <Image source={{ uri: item.gif_url }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={styles.thumbPlaceholder}>
                <Ionicons name="barbell-outline" size={18} color={colors.textMuted} />
              </View>
            )}
            <Text style={styles.label} numberOfLines={2}>
              {item.name}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No hay ejercicios con esos filtros.</Text>}
        contentContainerStyle={[styles.listContent, sections.length === 0 && styles.listContentEmpty]}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

function FilterChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.chipRowContent}>
      {options.map((o) => (
        <FilterChip key={o.key} label={o.label} isActive={value === o.key} onPress={() => onChange(o.key)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.sm },
  search: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  filterLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  chipRowWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chipRowContent: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: colors.primaryText },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: 2 },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    backgroundColor: colors.background,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  thumb: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: '#FFFFFF' },
  thumbPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, color: colors.text, fontSize: 15 },
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
});
