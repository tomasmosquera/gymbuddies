import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextField } from '@/components/ui/TextField';
import { MoneyField } from '@/components/ui/MoneyField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { useBrowsePublicGroups } from '@/hooks/useBrowsePublicGroups';
import { GROUP_TIMEZONE_OPTIONS, groupTimezoneLabel } from '@/constants/timezones';
import { PAYOUT_MODE_LABELS } from '@/constants/payoutModes';
import type { PayoutMode, PublicGroupListing } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

const MODE_OPTIONS: { key: 'all' | PayoutMode; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'cooperative', label: PAYOUT_MODE_LABELS.cooperative },
  { key: 'league', label: PAYOUT_MODE_LABELS.league },
  { key: 'mixed', label: PAYOUT_MODE_LABELS.mixed },
];

/** Same modal-list shape as TimezonePicker, but nullable ("Cualquiera" clears the filter) — TimezonePicker itself always requires a concrete value, so this stays a separate, screen-local variant instead of complicating that shared component. */
function TimezoneFilterField({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
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
        <Text style={styles.fieldValue}>{value ? groupTimezoneLabel(value) : 'Cualquiera'}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <Modal visible={isOpen} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Zona horaria / país</Text>
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
            <Pressable
              onPress={() => {
                onChange(null);
                close();
              }}
              style={[styles.row, value === null && styles.rowSelected]}
            >
              <Text style={[styles.label, value === null && styles.labelSelected]}>Cualquiera</Text>
              {value === null ? <Ionicons name="checkmark" size={18} color={colors.primaryText} /> : null}
            </Pressable>
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
                    <Text style={[styles.label, isSelected && styles.labelSelected]}>{item.label}</Text>
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

interface FiltersState {
  payoutModeChoice: 'all' | PayoutMode;
  maxInitialDeposit: string;
  maxPenaltyAmount: string;
  maxMinDaysPerWeek: string;
  timezone: string | null;
}

const EMPTY_FILTERS: FiltersState = {
  payoutModeChoice: 'all',
  maxInitialDeposit: '',
  maxPenaltyAmount: '',
  maxMinDaysPerWeek: '',
  timezone: null,
};

function activeFilterCount(f: FiltersState): number {
  return [
    f.payoutModeChoice !== 'all',
    f.maxInitialDeposit !== '',
    f.maxPenaltyAmount !== '',
    f.maxMinDaysPerWeek !== '',
    f.timezone !== null,
  ].filter(Boolean).length;
}

/** Every structured filter, tucked behind one button so the list of groups is what you see first — only the name search stays inline on the main screen. */
function FiltersModal({
  visible,
  filters,
  onChange,
  onClose,
}: {
  visible: boolean;
  filters: FiltersState;
  onChange: (next: FiltersState) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filtros</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Ionicons name="close" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.filtersBody}>
            <View style={styles.filterField}>
              <Text style={styles.filterLabel}>Modo de juego</Text>
              <SegmentedControl
                options={MODE_OPTIONS}
                value={filters.payoutModeChoice}
                onChange={(payoutModeChoice) => onChange({ ...filters, payoutModeChoice })}
              />
            </View>
            <MoneyField
              label="Depósito inicial — hasta"
              hint="Déjalo vacío para no filtrar."
              value={filters.maxInitialDeposit}
              onChangeValue={(maxInitialDeposit) => onChange({ ...filters, maxInitialDeposit })}
            />
            <MoneyField
              label="Penalización por día fallado — hasta"
              hint="Solo aplica de verdad en Cooperativo/Mixto — en Liga nunca se cobra. Déjalo vacío para no filtrar."
              value={filters.maxPenaltyAmount}
              onChangeValue={(maxPenaltyAmount) => onChange({ ...filters, maxPenaltyAmount })}
            />
            <TextField
              label="Días mínimos por semana — hasta"
              value={filters.maxMinDaysPerWeek}
              onChangeText={(v) => onChange({ ...filters, maxMinDaysPerWeek: v.replace(/[^0-9]/g, '') })}
              keyboardType="numeric"
              returnKeyType="done"
              placeholder="Sin límite"
            />
            <View style={styles.filterField}>
              <Text style={styles.filterLabel}>Zona horaria / país</Text>
              <TimezoneFilterField
                value={filters.timezone}
                onChange={(timezone) => onChange({ ...filters, timezone })}
              />
            </View>
          </View>
          <View style={styles.filtersActions}>
            <Button label="Limpiar filtros" variant="secondary" onPress={() => onChange(EMPTY_FILTERS)} />
            <Button label="Ver resultados" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PublicGroupCard({ group, onJoin, isJoining }: { group: PublicGroupListing; onJoin: () => void; isJoining: boolean }) {
  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{group.name}</Text>
        <Badge label={PAYOUT_MODE_LABELS[group.payout_mode]} />
      </View>
      <Text style={styles.cardFact}>
        {group.member_count} {group.member_count === 1 ? 'miembro' : 'miembros'} · {groupTimezoneLabel(group.timezone)}
      </Text>
      <Text style={styles.cardFact}>
        Depósito inicial: {group.currency} {group.initial_deposit_amount.toLocaleString('es-CO')}
      </Text>
      {group.payout_mode !== 'league' ? (
        <Text style={styles.cardFact}>
          Penalización: {group.currency} {group.penalty_amount.toLocaleString('es-CO')} · {group.min_days_per_week} día(s)
          mínimos/semana
        </Text>
      ) : (
        <Text style={styles.cardFact}>{group.min_days_per_week} día(s) mínimos/semana — sin multa en Liga</Text>
      )}
      <Button label="Unirme" onPress={onJoin} loading={isJoining} />
    </Card>
  );
}

export default function BrowsePublicGroupsScreen() {
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [joiningGroupId, setJoiningGroupId] = useState<string | null>(null);

  const { groups, isLoading, isJoining, join } = useBrowsePublicGroups({
    search,
    payoutMode: filters.payoutModeChoice === 'all' ? null : filters.payoutModeChoice,
    maxInitialDeposit: filters.maxInitialDeposit ? Number(filters.maxInitialDeposit) : null,
    maxPenaltyAmount: filters.maxPenaltyAmount ? Number(filters.maxPenaltyAmount) : null,
    maxMinDaysPerWeek: filters.maxMinDaysPerWeek ? Number(filters.maxMinDaysPerWeek) : null,
    timezone: filters.timezone,
  });

  const filterCount = activeFilterCount(filters);

  const handleJoin = async (groupId: string) => {
    setJoiningGroupId(groupId);
    try {
      const membership = await join(groupId);
      setActiveGroupId(membership.group_id);
      router.replace('/deposit');
    } catch (err) {
      Alert.alert('No se pudo unir al grupo', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setJoiningGroupId(null);
    }
  };

  return (
    <>
      <FlatList
        contentContainerStyle={styles.container}
        data={groups}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.topBar}>
            <TextField label="Buscar por nombre" value={search} onChangeText={setSearch} placeholder="Nombre del grupo" />
            <Pressable style={styles.filtersButton} onPress={() => setIsFiltersOpen(true)}>
              <Ionicons name="options-outline" size={18} color={colors.text} />
              <Text style={styles.filtersButtonText}>Filtros{filterCount > 0 ? ` (${filterCount})` : ''}</Text>
            </Pressable>
            {isLoading ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}
          </View>
        }
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              title="Sin resultados"
              description={filterCount > 0 ? 'No hay grupos públicos con esos filtros.' : 'No hay grupos públicos todavía.'}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <PublicGroupCard group={item} onJoin={() => handleJoin(item.id)} isJoining={isJoining && joiningGroupId === item.id} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
      <FiltersModal
        visible={isFiltersOpen}
        filters={filters}
        onChange={setFilters}
        onClose={() => setIsFiltersOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  topBar: { gap: spacing.sm, marginBottom: spacing.lg },
  filtersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filtersButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  loading: { marginTop: spacing.sm },
  filtersBody: { gap: spacing.md },
  filtersActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  filterField: { gap: spacing.xs },
  filterLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  card: { gap: spacing.xs },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { ...typography.heading, fontSize: 17, color: colors.text, flexShrink: 1 },
  cardFact: { color: colors.textMuted, fontSize: 13 },
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
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
  label: { color: colors.text, fontSize: 15 },
  labelSelected: { color: colors.primaryText, fontWeight: '600' },
});
