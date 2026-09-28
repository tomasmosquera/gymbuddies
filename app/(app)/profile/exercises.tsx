import { useMemo, useState } from 'react';
import { Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { EQUIPMENT_LABELS, EQUIPMENT_ORDER } from '@/constants/equipment';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_ORDER } from '@/constants/muscleGroups';
import { useExerciseCatalog } from '@/hooks/useExerciseCatalog';
import { useMyPerformedExerciseIds } from '@/hooks/useMyPerformedExerciseIds';
import { colors, radii, spacing, typography } from '@/constants/theme';
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

function FilterChipGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.chipGrid}>
      {options.map((o) => (
        <FilterChip key={o.key} label={o.label} isActive={value === o.key} onPress={() => onChange(o.key)} />
      ))}
    </View>
  );
}

interface FiltersModalProps {
  visible: boolean;
  onClose: () => void;
  muscleFilter: MuscleFilter;
  onMuscleFilterChange: (v: MuscleFilter) => void;
  equipmentFilter: EquipmentFilter;
  onEquipmentFilterChange: (v: EquipmentFilter) => void;
}

/** Same bottom-sheet shape as ExercisePickerModal — tucked behind a "Filtros" button instead of always on screen, so the list itself is what greets you first. */
function FiltersModal({ visible, onClose, muscleFilter, onMuscleFilterChange, equipmentFilter, onEquipmentFilterChange }: FiltersModalProps) {
  const insets = useSafeAreaInsets();
  const hasFilters = muscleFilter !== 'all' || equipmentFilter !== 'all';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropDismiss} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filtros</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>

          <Text style={styles.filterLabel}>Músculo</Text>
          <FilterChipGrid
            options={[{ key: 'all' as const, label: 'Todos' }, ...MUSCLE_GROUP_ORDER.map((g) => ({ key: g, label: MUSCLE_GROUP_LABELS[g] }))]}
            value={muscleFilter}
            onChange={onMuscleFilterChange}
          />

          <Text style={[styles.filterLabel, styles.filterLabelSpaced]}>Equipo</Text>
          <FilterChipGrid
            options={[{ key: 'all' as const, label: 'Todos' }, ...EQUIPMENT_ORDER.map((eq) => ({ key: eq, label: EQUIPMENT_LABELS[eq] }))]}
            value={equipmentFilter}
            onChange={onEquipmentFilterChange}
          />

          <View style={styles.sheetActions}>
            {hasFilters ? (
              <Button
                label="Limpiar filtros"
                variant="secondary"
                onPress={() => {
                  onMuscleFilterChange('all');
                  onEquipmentFilterChange('all');
                }}
              />
            ) : null}
            <Button label="Ver resultados" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Perfil → Rutinas → Ejercicios: browse the whole catalog. Search stays
 * inline (it's how most people look something up); muscle/equipment filters
 * live behind a "Filtros" button instead — showing all 23 filter chips
 * up front pushed the actual list (the point of this screen) below the fold.
 * Tapping a row goes straight to exercise-detail.tsx's Resumen/Histórico/
 * Grupo/Explicación tabs.
 */
export default function ExercisesScreen() {
  const { exercises } = useExerciseCatalog();
  const { ids: performedIds } = useMyPerformedExerciseIds();
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<MuscleFilter>('all');
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentFilter>('all');
  const [performedOnly, setPerformedOnly] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const activeFilterCount = (muscleFilter !== 'all' ? 1 : 0) + (equipmentFilter !== 'all' ? 1 : 0);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = exercises.filter(
      (e) =>
        (!q || e.name.toLowerCase().includes(q)) &&
        (muscleFilter === 'all' || e.muscle_group === muscleFilter) &&
        (equipmentFilter === 'all' || e.equipment === equipmentFilter) &&
        (!performedOnly || performedIds.has(e.id))
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
  }, [exercises, query, muscleFilter, equipmentFilter, performedOnly, performedIds]);

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar ejercicio..."
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCorrect={false}
        />
        <Pressable
          onPress={() => setPerformedOnly((v) => !v)}
          style={[styles.filterButton, performedOnly && styles.filterButtonActive]}
          accessibilityRole="button"
          accessibilityLabel="Mostrar solo los ejercicios que ya he hecho"
        >
          <Ionicons name={performedOnly ? 'star' : 'star-outline'} size={18} color={performedOnly ? colors.primaryText : colors.text} />
        </Pressable>
        <Pressable
          onPress={() => setIsFiltersOpen(true)}
          style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}
          accessibilityRole="button"
        >
          <Ionicons name="options-outline" size={18} color={activeFilterCount > 0 ? colors.primaryText : colors.text} />
          {activeFilterCount > 0 ? (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </Pressable>
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
        ListEmptyComponent={
          <Text style={styles.empty}>
            {performedOnly ? 'Todavía no has registrado ninguno de estos ejercicios.' : 'No hay ejercicios con esos filtros.'}
          </Text>
        }
        contentContainerStyle={[styles.listContent, sections.length === 0 && styles.listContentEmpty]}
        keyboardShouldPersistTaps="handled"
      />

      <FiltersModal
        visible={isFiltersOpen}
        onClose={() => setIsFiltersOpen(false)}
        muscleFilter={muscleFilter}
        onMuscleFilterChange={setMuscleFilter}
        equipmentFilter={equipmentFilter}
        onEquipmentFilterChange={setEquipmentFilter}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.sm },
  searchRow: { flexDirection: 'row', gap: spacing.sm },
  search: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  filterButton: {
    width: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
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
  // FiltersModal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  backdropDismiss: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    maxHeight: '80%',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.heading, fontSize: 17, color: colors.text },
  filterLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.sm },
  filterLabelSpaced: { marginTop: spacing.lg },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: colors.primaryText },
  sheetActions: { gap: spacing.sm, marginTop: spacing.lg },
});
