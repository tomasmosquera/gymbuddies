import { useMemo, useState } from 'react';
import { Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUP_ORDER } from '@/constants/muscleGroups';
import { useExerciseCatalog } from '@/hooks/useExerciseCatalog';
import { colors, radii, spacing, typography } from '@/constants/theme';
import type { Exercise } from '@/lib/supabase/types';

interface ExercisePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (exercise: Exercise) => void;
  /** Exercises already in the list this picker is adding to — greyed out and unselectable, so the same exercise can't be added twice. */
  excludeIds?: string[];
}

/** Searchable "pick one exercise from the ~100+ catalog" sheet, grouped by muscle group — same shape as TimezonePicker. */
export function ExercisePickerModal({ visible, onClose, onSelect, excludeIds = [] }: ExercisePickerModalProps) {
  const { exercises } = useExerciseCatalog();
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? exercises.filter((e) => e.name.toLowerCase().includes(q)) : exercises;
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
  }, [exercises, query]);

  const close = () => {
    setQuery('');
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
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
            renderItem={({ item }) => {
              const isTaken = excludeIds.includes(item.id);
              return (
                <Pressable
                  accessibilityRole="button"
                  disabled={isTaken}
                  onPress={() => {
                    onSelect(item);
                    close();
                  }}
                  style={[styles.row, isTaken && styles.rowDisabled]}
                >
                  <Text style={[styles.label, isTaken && styles.labelDisabled]}>{item.name}</Text>
                  {isTaken ? <Ionicons name="checkmark-circle" size={18} color={colors.textMuted} /> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>No hay ejercicios con ese nombre.</Text>}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
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
    maxHeight: '85%',
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
  list: { flexGrow: 0 },
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
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  rowDisabled: { opacity: 0.4 },
  label: { color: colors.text, fontSize: 15 },
  labelDisabled: { color: colors.textMuted },
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
});
