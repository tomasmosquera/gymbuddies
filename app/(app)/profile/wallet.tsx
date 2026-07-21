import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useWallet, type WeeklyEvaluationResultWithRun } from '@/hooks/useWallet';
import type { WalletTransaction, WalletTransactionStatus, WalletTransactionType } from '@/lib/supabase/types';
import { colors, spacing, typography } from '@/constants/theme';

const TYPE_LABELS: Record<WalletTransactionType, string> = {
  initial_deposit: 'Depósito inicial',
  recharge: 'Recarga',
  penalty: 'Penalización',
  adjustment: 'Ajuste',
};

const STATUS_TONE: Record<WalletTransactionStatus, 'success' | 'warning' | 'danger'> = {
  confirmed: 'success',
  pending: 'warning',
  rejected: 'danger',
};

const STATUS_LABELS: Record<WalletTransactionStatus, string> = {
  confirmed: 'Confirmado',
  pending: 'Pendiente',
  rejected: 'Rechazado',
};

const FILTER_OPTIONS: { key: 'all' | 'penalties'; label: string }[] = [
  { key: 'all', label: 'Todo' },
  { key: 'penalties', label: 'Penalizaciones' },
];

function TransactionRow({
  transaction,
  result,
}: {
  transaction: WalletTransaction;
  result: WeeklyEvaluationResultWithRun | undefined;
}) {
  const isNegative = transaction.amount < 0;
  return (
    <Card style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.rowLeft}>
          <Text style={styles.rowTitle}>{TYPE_LABELS[transaction.type]}</Text>
          <Text style={styles.rowDate}>{new Date(transaction.created_at).toLocaleDateString('es-CO')}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.amount, isNegative ? styles.amountNegative : styles.amountPositive]}>
            {isNegative ? '-' : '+'}
            {Math.abs(transaction.amount).toLocaleString('es-CO')}
          </Text>
          <Badge label={STATUS_LABELS[transaction.status]} tone={STATUS_TONE[transaction.status]} />
        </View>
      </View>
      {result ? (
        <Text style={styles.resultDetail}>
          Semana del {new Date(result.run.week_start_date).toLocaleDateString('es-CO')} al{' '}
          {new Date(result.run.week_end_date).toLocaleDateString('es-CO')} · {result.failed_days} de{' '}
          {result.required_days} día(s) fallados
          {result.excused_days_used > 0 ? ` · ${result.excused_days_used} excusado(s)` : ''}
        </Text>
      ) : null}
    </Card>
  );
}

export default function WalletScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading } = useActiveGroup();
  const {
    transactions,
    resultById,
    totalPenaltiesPaid,
    weeksWithFailures,
    isLoading: walletLoading,
    refresh,
  } = useWallet(group?.id ?? null, session?.user.id ?? null);
  const [filter, setFilter] = useState<'all' | 'penalties'>('all');

  const filteredTransactions = useMemo(
    () => (filter === 'penalties' ? transactions.filter((t) => t.type === 'penalty') : transactions),
    [transactions, filter]
  );

  // Refetches every time this screen gains focus — a penalty applied or a
  // recharge confirmed while this screen was already open earlier in the
  // stack otherwise never shows up without a pull-to-refresh or app restart.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Only the essentials gate the whole screen — refetching on focus should
  // update the list in place, never blank out the balance/summary while a
  // background fetch is in flight.
  if (groupLoading || !group || !membership) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={filteredTransactions}
      keyExtractor={(item) => item.id}
      onRefresh={refresh}
      refreshing={walletLoading}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.balanceLabel}>Saldo disponible</Text>
          <Text style={styles.balance}>
            {group.currency} {membership.balance.toLocaleString('es-CO')}
          </Text>
          <Button label="Registrar recarga" onPress={() => router.push('/profile/wallet-recharge')} />

          <Card style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Resumen de penalizaciones</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Total pagado en multas</Text>
              <Text style={styles.summaryValue}>
                {group.currency} {totalPenaltiesPaid.toLocaleString('es-CO')}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Semanas con días fallados</Text>
              <Text style={styles.summaryValue}>{weeksWithFailures}</Text>
            </View>
          </Card>

          <SegmentedControl options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          title="Sin movimientos"
          description={filter === 'penalties' ? 'Todavía no tienes penalizaciones.' : 'Aquí verás tus depósitos y penalizaciones.'}
        />
      }
      renderItem={({ item }) => (
        <TransactionRow
          transaction={item}
          result={item.weekly_evaluation_result_id ? resultById.get(item.weekly_evaluation_result_id) : undefined}
        />
      )}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.background, flexGrow: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.lg },
  balanceLabel: { color: colors.textMuted },
  balance: { ...typography.title, color: colors.text },
  summaryCard: { gap: spacing.xs, marginTop: spacing.sm },
  summaryTitle: { ...typography.heading, fontSize: 15, color: colors.text, marginBottom: spacing.xs },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: colors.textMuted },
  summaryValue: { color: colors.text, fontWeight: '700' },
  row: { gap: spacing.xs },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLeft: { gap: 2 },
  rowTitle: { color: colors.text, fontWeight: '600' },
  rowDate: { color: colors.textMuted, fontSize: 12 },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  amount: { fontWeight: '700' },
  amountPositive: { color: colors.success },
  amountNegative: { color: colors.danger },
  resultDetail: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
