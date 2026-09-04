import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useMyAdminOverview, type MyGroupAdminSummary } from '@/hooks/useMyAdminOverview';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { PAYOUT_MODE_LABELS } from '@/constants/payoutModes';
import { colors, radii, spacing, typography } from '@/constants/theme';

function AdminGroupCard({ summary, onPress }: { summary: MyGroupAdminSummary; onPress: () => void }) {
  const { membership, overview, totalPendingCount } = summary;
  const group = membership.group;

  return (
    <Pressable onPress={onPress}>
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerInfo}>
            <Text style={styles.groupName} numberOfLines={1}>
              {group.name}
            </Text>
            <Badge label={PAYOUT_MODE_LABELS[group.payout_mode]} />
          </View>
          {totalPendingCount > 0 ? (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{totalPendingCount}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{overview.activeMembers}</Text>
            <Text style={styles.statLabel}>Activos</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{overview.pendingDepositMembers}</Text>
            <Text style={styles.statLabel}>Sin depósito</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={[styles.statValue, overview.needsRechargeMembers > 0 && styles.statValueWarning]}>
              {overview.needsRechargeMembers}
            </Text>
            <Text style={styles.statLabel}>Necesitan recarga</Text>
          </View>
        </View>

        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Saldo total del grupo</Text>
          <Text style={styles.ruleValue}>
            {group.currency} {overview.totalGroupBalance.toLocaleString('es-CO')}
          </Text>
        </View>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Cuotas de inscripción cobradas</Text>
          <Text style={styles.ruleValue}>
            {group.currency} {overview.totalEnrollmentFeesCollected.toLocaleString('es-CO')}
          </Text>
        </View>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Cumplimiento esta semana</Text>
          <Text style={styles.ruleValue}>
            {overview.weekCompliancePercent !== null ? `${overview.weekCompliancePercent}%` : '—'}
          </Text>
        </View>

        {group.payout_mode === 'league' && overview.pendingLeagueDeparturesCount > 0 ? (
          <Text style={styles.departuresNotice}>
            {overview.pendingLeagueDeparturesCount} salida
            {overview.pendingLeagueDeparturesCount === 1 ? '' : 's'} sin liquidar
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function AdminDashboardScreen() {
  const { summaries, totalPendingCount, isLoading, refresh } = useMyAdminOverview();
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelect = (summary: MyGroupAdminSummary) => {
    setActiveGroupId(summary.membership.group_id);
    router.push('/profile/admin');
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={summaries}
      keyExtractor={(item) => item.membership.group_id}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.subtitle}>
            {summaries.length === 0
              ? 'No administras ningún grupo todavía.'
              : totalPendingCount > 0
                ? summaries.length === 1
                  ? `Tienes ${totalPendingCount} pendiente${totalPendingCount === 1 ? '' : 's'} en tu grupo.`
                  : `Tienes ${totalPendingCount} pendiente${totalPendingCount === 1 ? '' : 's'} en tus ${summaries.length} grupos.`
                : summaries.length === 1
                  ? 'Al día en tu grupo — sin pendientes.'
                  : `Al día en tus ${summaries.length} grupos — sin pendientes.`}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <EmptyState title="Sin grupos para administrar" description="Solo los grupos donde eres admin aparecen aquí." />
      }
      renderItem={({ item }) => <AdminGroupCard summary={item} onPress={() => handleSelect(item)} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  header: { marginBottom: spacing.md },
  subtitle: { color: colors.textMuted, fontSize: 13 },
  card: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  headerInfo: { flex: 1, gap: 4 },
  groupName: { ...typography.heading, color: colors.text },
  pendingBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  pendingBadgeText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  statTile: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  statValueWarning: { color: colors.danger },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2, textAlign: 'center' },
  ruleRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  ruleLabel: { color: colors.textMuted, fontSize: 13 },
  ruleValue: { color: colors.text, fontWeight: '600', fontSize: 13 },
  departuresNotice: { color: colors.warning, fontSize: 12, fontWeight: '600' },
});
