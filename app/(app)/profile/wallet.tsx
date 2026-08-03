import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useWallet, type WeeklyEvaluationResultWithRun } from '@/hooks/useWallet';
import { useLiquidationPreview } from '@/hooks/useLiquidationPreview';
import { useGroupMembers } from '@/hooks/useGroupMembers';
import { supabase } from '@/lib/supabase/client';
import type { WalletTransaction, WalletTransactionStatus, WalletTransactionType } from '@/lib/supabase/types';
import { colors, spacing, typography } from '@/constants/theme';

const TYPE_LABELS: Record<WalletTransactionType, string> = {
  initial_deposit: 'Depósito inicial',
  recharge: 'Recarga',
  penalty: 'Penalización',
  adjustment: 'Ajuste',
  payout: 'Fondo común / Liga',
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

/**
 * Live "reparto de hoy" — what every active member gets if the group is
 * settled right now, per liquidate_group_now (dry-run for everyone,
 * real execution admin-only). Cooperativo/Mixto also lets the admin
 * adjust each member's relative % inline, right where they can see its
 * effect on the preview.
 */
function LiquidationCard({
  groupId,
  currency,
  payoutMode,
  isAdmin,
}: {
  groupId: string;
  currency: string;
  payoutMode: 'cooperative' | 'league' | 'mixed';
  isAdmin: boolean;
}) {
  const { rows, errorMessage, isLoading, refresh, liquidateNow } = useLiquidationPreview(groupId);
  const { members, refresh: refreshMembers } = useGroupMembers(groupId);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isLiquidating, setIsLiquidating] = useState(false);

  const activeMembers = useMemo(
    () => members.filter((m) => m.status === 'active' || m.status === 'needs_recharge'),
    [members]
  );
  const totalWeight = activeMembers.reduce((sum, m) => sum + m.cooperative_weight, 0);
  const percentByUserId = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of activeMembers) map.set(m.user_id, totalWeight > 0 ? (m.cooperative_weight / totalWeight) * 100 : 0);
    return map;
  }, [activeMembers, totalWeight]);
  const memberIdByUserId = useMemo(() => new Map(activeMembers.map((m) => [m.user_id, m.id])), [activeMembers]);

  const canEditWeights = isAdmin && payoutMode !== 'league';

  const handleSaveEdit = async (userId: string) => {
    const memberId = memberIdByUserId.get(userId);
    const percent = Number(editValue);
    if (!memberId || !editValue || Number.isNaN(percent) || percent <= 0 || percent >= 100) {
      Alert.alert('Porcentaje inválido', 'Ingresa un número mayor a 0 y menor a 100.');
      return;
    }
    setIsSavingEdit(true);
    try {
      const { error } = await supabase.rpc('admin_set_cooperative_share_percent', {
        p_member_id: memberId,
        p_target_percent: percent,
      });
      if (error) throw new Error(error.message);
      setEditingUserId(null);
      await Promise.all([refresh(), refreshMembers()]);
    } catch (err) {
      Alert.alert('No se pudo ajustar el %', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleLiquidate = async () => {
    setIsLiquidating(true);
    try {
      await liquidateNow();
      await refreshMembers();
      Alert.alert('Listo', 'El grupo fue liquidado — ya se le notificó a cada quien cuánto le corresponde.');
    } catch (err) {
      Alert.alert('No se pudo liquidar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsLiquidating(false);
    }
  };

  const confirmLiquidate = () => {
    const summary = rows.map((r) => `${r.full_name}: ${currency} ${r.amount.toLocaleString('es-CO')}`).join('\n');
    Alert.alert('Liquidar ahora', `Esto reparte todo el fondo y deja el saldo de todos en $0. El grupo sigue activo.\n\n${summary}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Liquidar', style: 'destructive', onPress: handleLiquidate },
    ]);
  };

  return (
    <Card style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>Reparto de hoy</Text>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : errorMessage ? (
        <Text style={styles.liquidationError}>{errorMessage}</Text>
      ) : (
        <>
          {[...rows]
            .sort((a, b) => b.amount - a.amount)
            .map((row) => (
              <View key={row.user_id} style={styles.liquidationRow}>
                <View style={styles.liquidationRowMain}>
                  <Text style={styles.liquidationName}>
                    {row.place ? '🏆 ' : ''}
                    {row.full_name}
                  </Text>
                  <Text style={styles.liquidationAmount}>
                    {currency} {row.amount.toLocaleString('es-CO')}
                  </Text>
                </View>
                {canEditWeights ? (
                  editingUserId === row.user_id ? (
                    <View style={styles.editRow}>
                      <TextField
                        label=""
                        value={editValue}
                        onChangeText={setEditValue}
                        keyboardType="numeric"
                        placeholder={`${(percentByUserId.get(row.user_id) ?? 0).toFixed(1)}%`}
                        style={styles.editInput}
                      />
                      <Button label="Guardar" onPress={() => handleSaveEdit(row.user_id)} loading={isSavingEdit} />
                      <Button label="Cancelar" variant="secondary" onPress={() => setEditingUserId(null)} />
                    </View>
                  ) : (
                    <Button
                      label={`Editar % (${(percentByUserId.get(row.user_id) ?? 0).toFixed(1)}%)`}
                      variant="secondary"
                      onPress={() => {
                        setEditingUserId(row.user_id);
                        setEditValue('');
                      }}
                    />
                  )
                ) : null}
              </View>
            ))}
          {isAdmin ? (
            <Button
              label="Liquidar ahora"
              variant="danger"
              onPress={confirmLiquidate}
              loading={isLiquidating}
              disabled={rows.length === 0}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

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

          <LiquidationCard
            groupId={group.id}
            currency={group.currency}
            payoutMode={group.payout_mode}
            isAdmin={membership.role === 'admin'}
          />

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
  liquidationError: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  liquidationRow: { gap: spacing.xs, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  liquidationRowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liquidationName: { color: colors.text, fontWeight: '600' },
  liquidationAmount: { color: colors.text, fontWeight: '700' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editInput: { flex: 1, paddingVertical: spacing.xs },
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
