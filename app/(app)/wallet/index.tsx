import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useWallet } from '@/hooks/useWallet';
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

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  const isNegative = transaction.amount < 0;
  return (
    <Card style={styles.row}>
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
    </Card>
  );
}

export default function WalletScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading } = useActiveGroup();
  const { transactions, isLoading: walletLoading, refresh } = useWallet(group?.id ?? null, session?.user.id ?? null);

  if (groupLoading || walletLoading || !group || !membership) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={transactions}
      keyExtractor={(item) => item.id}
      onRefresh={refresh}
      refreshing={false}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.balanceLabel}>Saldo disponible</Text>
          <Text style={styles.balance}>
            {group.currency} {membership.balance.toLocaleString('es-CO')}
          </Text>
          <Button label="Registrar recarga" onPress={() => router.push('/wallet/recharge')} />
        </View>
      }
      ListEmptyComponent={<EmptyState title="Sin movimientos" description="Aquí verás tus depósitos y penalizaciones." />}
      renderItem={({ item }) => <TransactionRow transaction={item} />}
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLeft: { gap: 2 },
  rowTitle: { color: colors.text, fontWeight: '600' },
  rowDate: { color: colors.textMuted, fontSize: 12 },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  amount: { fontWeight: '700' },
  amountPositive: { color: colors.success },
  amountNegative: { color: colors.danger },
});
