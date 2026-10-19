import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { matchesExerciseQuery } from '@/lib/domain/exerciseSearch';
import type { LoggedExercise } from '@/hooks/useLoggedExercises';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface LoggedExercisePickerModalProps {
  visible: boolean;
  exercises: readonly LoggedExercise[];
  onClose: () => void;
  onSelect: (exercise: LoggedExercise) => void;
}

/** Same bottom-sheet shape as ExercisePickerModal, but over `exercises` (already filtered to
 * ones with logged data) instead of the whole catalog — no muscle/equipment filters or info
 * button, just search + a flat, most-recent-first list. */
export function LoggedExercisePickerModal({ visible, exercises, onClose, onSelect }: LoggedExercisePickerModalProps) {
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();

  const filtered = useMemo(() => exercises.filter((e) => matchesExerciseQuery(e.name, query)), [exercises, query]);

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
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => {
                  onSelect(item);
                  close();
                }}
                accessibilityRole="button"
              >
                <Text style={styles.label} numberOfLines={2}>
                  {item.name}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No hay ejercicios con esos filtros.</Text>}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            contentContainerStyle={filtered.length === 0 ? styles.listContentEmpty : undefined}
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
    height: '70%',
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
  list: { flex: 1 },
  listContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  label: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  empty: { color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
});
