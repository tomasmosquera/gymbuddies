import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { XpHistoryEntry } from '@/lib/domain/xpHistory';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface XpHistoryModalProps {
  visible: boolean;
  entries: XpHistoryEntry[];
  onClose: () => void;
}

/** "YYYY-MM-DD" or a full ISO timestamp → "DD/MM/YYYY" via plain string slicing — deliberately not new Date(...).toLocaleDateString(...): round-tripping a bare date-only string through Date() parses it as UTC midnight, which can display a day off in a zone west of UTC (an existing footgun elsewhere in the app, not worth propagating into a new screen). null (the check-ins running total) isn't tied to a date at all. */
function formatEntryDate(date: string | null): string {
  if (date === null) return 'Acumulado';
  const [year, month, day] = date.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function HistoryRow({ entry }: { entry: XpHistoryEntry }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowEmoji}>{entry.emoji}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {entry.title}
        </Text>
        <Text style={styles.rowDate}>{formatEntryDate(entry.date)}</Text>
      </View>
      <View style={styles.xpPill}>
        <Text style={styles.xpText}>+{entry.xp} XP</Text>
      </View>
    </View>
  );
}

/** Full-screen chronological list of every XP-granting event for a member — mirrors KothVideoModal's fullscreen-modal-with-close-button structure. */
export function XpHistoryModal({ visible, entries, onClose }: XpHistoryModalProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.headerTitle}>Historial de XP</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={16} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Cerrar ✕</Text>
          </Pressable>
        </View>
        <FlatList
          data={entries}
          keyExtractor={(entry, i) => `${entry.source}-${entry.date}-${i}`}
          renderItem={({ item }) => <HistoryRow entry={item} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>Todavía no tienes XP registrado.</Text>}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: { ...typography.heading, fontSize: 18, color: colors.text },
  closeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeButtonText: { color: colors.text, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  rowEmoji: { fontSize: 22, width: 30, textAlign: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rowDate: { color: colors.textMuted, fontSize: 12 },
  xpPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  xpText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.xl },
});
