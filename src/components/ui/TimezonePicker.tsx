import { useMemo, useState } from 'react';
import { Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GROUP_TIMEZONE_OPTIONS, groupTimezoneLabel, timezoneOffsetLabel } from '@/constants/timezones';
import { colors, radii, spacing, typography } from '@/constants/theme';

/**
 * Dropdown for a group's IANA timezone — a closed field that opens a
 * searchable modal list, grouped by region. Governs which calendar day/week
 * a group's check-ins land on and which country's fixed holidays apply (see
 * groups.timezone / TIMEZONE_COUNTRY).
 */
export function TimezonePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? GROUP_TIMEZONE_OPTIONS.filter((o) => o.label.toLowerCase().includes(q)) : GROUP_TIMEZONE_OPTIONS;
    const byGroup = new Map<string, typeof GROUP_TIMEZONE_OPTIONS>();
    for (const option of filtered) {
      const list = byGroup.get(option.group) ?? [];
      list.push(option);
      byGroup.set(option.group, list);
    }
    return [...byGroup.entries()].map(([title, data]) => ({ title, data }));
  }, [query]);

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setIsOpen(true)} style={styles.field}>
        <View>
          <Text style={styles.fieldValue}>{groupTimezoneLabel(value)}</Text>
          <Text style={styles.fieldOffset}>{timezoneOffsetLabel(value)}</Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal visible={isOpen} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropDismiss} onPress={close} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Zona horaria del grupo</Text>
              <Pressable onPress={close} hitSlop={8} accessibilityRole="button">
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar país o ciudad..."
              placeholderTextColor={colors.textMuted}
              style={styles.search}
              autoCorrect={false}
            />
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.value}
              renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}
                    style={[styles.row, isSelected && styles.rowSelected]}
                  >
                    <View style={styles.rowLabels}>
                      <Text style={[styles.label, isSelected && styles.labelSelected]}>{item.label}</Text>
                      <Text style={[styles.rowOffset, isSelected && styles.rowOffsetSelected]}>
                        {timezoneOffsetLabel(item.value)}
                      </Text>
                    </View>
                    {isSelected ? <Ionicons name="checkmark" size={18} color={colors.primaryText} /> : null}
                  </Pressable>
                );
              }}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldValue: { color: colors.text, fontSize: 16, fontWeight: '600' },
  fieldOffset: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  backdropDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    maxHeight: '80%',
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
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  rowSelected: { backgroundColor: colors.primary },
  rowLabels: { flex: 1, marginRight: spacing.sm },
  label: { color: colors.text, fontSize: 15 },
  labelSelected: { color: colors.primaryText, fontWeight: '600' },
  rowOffset: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  rowOffsetSelected: { color: colors.primaryText },
});
