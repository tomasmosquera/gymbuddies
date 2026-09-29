import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EQUIPMENT_LABELS, EQUIPMENT_ORDER } from '@/constants/equipment';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_ORDER } from '@/constants/muscleGroups';
import { matchesExerciseQuery } from '@/lib/domain/exerciseSearch';
import { useExerciseCatalog } from '@/hooks/useExerciseCatalog';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { Equipment, Exercise, MuscleGroup } from '@/lib/supabase/types';

type MuscleFilter = MuscleGroup | 'all';
type EquipmentFilter = Equipment | 'all';

interface ExercisePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
  /** Exercises already in the list this picker is adding to — greyed out and unselectable, so the same exercise can't be added twice. */
  excludeIds?: string[];
}

function FilterChip({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, isActive && styles.chipActive]} accessibilityRole="button">
      <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Searchable, filterable "pick one exercise from the ~100+ catalog" sheet — search by name, plus chip filters by muscle group and equipment, same shape as TimezonePicker. */
export function ExercisePickerModal({ visible, onClose, onSelect, excludeIds = [] }: ExercisePickerModalProps) {
  const { exercises } = useExerciseCatalog();
  const [query, setQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<MuscleFilter>('all');
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentFilter>('all');
  const insets = useSafeAreaInsets();

  const sections = useMemo(() => {
    const filtered = exercises.filter(
      (e) =>
        matchesExerciseQuery(e.name, query) &&
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

  const close = () => {
    setQuery('');
    setMuscleFilter('all');
    setEquipmentFilter('all');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropDismiss} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Elegir ejercicio</Text>
            <Pressable onPress={close} hitSlop={8} accessibilityRole="button">
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar ejercicio..."
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCorrect={false}
          />

          <Text style={styles.filterLabel}>Músculo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
            <FilterChip label="Todos" isActive={muscleFilter === 'all'} onPress={() => setMuscleFilter('all')} />
            {MUSCLE_GROUP_ORDER.map((g) => (
              <FilterChip key={g} label={MUSCLE_GROUP_LABELS[g]} isActive={muscleFilter === g} onPress={() => setMuscleFilter(g)} />
            ))}
          </ScrollView>

          <Text style={styles.filterLabel}>Equipo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
            <FilterChip label="Todos" isActive={equipmentFilter === 'all'} onPress={() => setEquipmentFilter('all')} />
            {EQUIPMENT_ORDER.map((eq) => (
              <FilterChip key={eq} label={EQUIPMENT_LABELS[eq]} isActive={equipmentFilter === eq} onPress={() => setEquipmentFilter(eq)} />
            ))}
          </ScrollView>

          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
            renderItem={({ item }) => {
              const isTaken = excludeIds.includes(item.id);
              return (
                <View style={[styles.row, isTaken && styles.rowDisabled]}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isTaken}
                    onPress={() => {
                      onSelect(item);
                      close();
                    }}
                    style={styles.rowMain}
                  >
                    {item.gif_url ? (
                      // autoplay={false} shows the still first frame instead of
                      // animating — a Hevy-style static thumbnail from the exact
                      // same asset exercise-detail.tsx plays as a GIF elsewhere,
                      // no separate image needed.
                      <Image source={{ uri: item.gif_url }} style={styles.thumb} contentFit="cover" autoplay={false} />
                    ) : (
                      <View style={styles.thumbPlaceholder} />
                    )}
                    <View style={styles.rowLabel}>
                      <Text style={[styles.label, isTaken && styles.labelDisabled]} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.muscleLabel}>{MUSCLE_GROUP_LABELS[item.muscle_group]}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      close();
                      router.push({ pathname: '/profile/exercise-detail', params: { exerciseId: item.id } });
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver detalle de ${item.name}`}
                  >
                    <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
                  </Pressable>
                  {isTaken ? <Ionicons name="checkmark-circle" size={18} color={colors.textMuted} /> : null}
                </View>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>No hay ejercicios con esos filtros.</Text>}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            contentContainerStyle={sections.length === 0 ? styles.listContentEmpty : undefined}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  backdropDismiss: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    height: '88%',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  sheetTitle: { ...typography.heading, fontSize: 17, color: colors.text },
  search: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  filterLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.xs },
  chipRow: { flexGrow: 0, height: 40, marginBottom: spacing.sm },
  chipRowContent: { gap: spacing.xs, paddingRight: spacing.md, alignItems: 'center' },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: colors.primaryText },
  list: { flex: 1 },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    backgroundColor: colors.surface,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  rowDisabled: { opacity: 0.4 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: '#FFFFFF' },
  thumbPlaceholder: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  rowLabel: { flex: 1, gap: 2 },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  labelDisabled: { color: colors.textMuted },
  muscleLabel: { color: colors.textMuted, fontSize: 13 },
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
});
