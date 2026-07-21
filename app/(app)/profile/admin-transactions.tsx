import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { getSignedUrl } from '@/lib/supabase/storage';
import type { WalletTransaction } from '@/lib/supabase/types';
import { colors, radii, spacing } from '@/constants/theme';

interface PendingTransaction extends WalletTransaction {
  member_name: string;
}

function PendingTransactionRow({
  transaction,
  onDecided,
}: {
  transaction: PendingTransaction;
  onDecided: () => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isDeciding, setIsDeciding] = useState(false);

  useEffect(() => {
    if (transaction.receipt_path) {
      getSignedUrl('receipts', transaction.receipt_path).then(setSignedUrl).catch(() => setSignedUrl(null));
    }
  }, [transaction.receipt_path]);

  const decide = async (status: 'confirmed' | 'rejected') => {
    setIsDeciding(true);
    try {
      const { error } = await supabase.from('wallet_transactions').update({ status }).eq('id', transaction.id);
      if (error) throw new Error(error.message);
      onDecided();
    } catch (err) {
      Alert.alert('No se pudo actualizar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeciding(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('Eliminar transferencia', '¿Eliminar esta transferencia pendiente? No se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: handleDelete },
    ]);
  };

  const handleDelete = async () => {
    setIsDeciding(true);
    try {
      const { error } = await supabase.rpc('admin_delete_wallet_transaction', { p_transaction_id: transaction.id });
      if (error) throw new Error(error.message);
      onDecided();
    } catch (err) {
      Alert.alert('No se pudo eliminar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeciding(false);
    }
  };

  return (
    <Card style={styles.row}>
      <Text style={styles.rowTitle}>{transaction.member_name}</Text>
      <Text style={styles.rowSubtitle}>
        {transaction.type === 'initial_deposit' ? 'Depósito inicial' : 'Recarga'} · {transaction.amount.toLocaleString('es-CO')}
      </Text>
      {signedUrl ? <Image source={{ uri: signedUrl }} style={styles.receipt} /> : null}
      <View style={styles.actions}>
        <Button label="Confirmar" onPress={() => decide('confirmed')} loading={isDeciding} />
        <Button label="Rechazar" variant="danger" onPress={() => decide('rejected')} loading={isDeciding} />
      </View>
      <Button label="Eliminar" variant="secondary" onPress={confirmDelete} loading={isDeciding} />
    </Card>
  );
}

export default function AdminTransactionsScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const [transactions, setTransactions] = useState<PendingTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!group) return;
      if (opts?.silent) setIsRefreshing(true);
      else setIsLoading(true);
      const { data, error } = await supabase
        .from('wallet_transactions')
        .select('*, profile:profiles!user_id(full_name)')
        .eq('group_id', group.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) {
        Alert.alert('No se pudieron cargar las transferencias', error.message);
      } else if (data) {
        try {
          setTransactions(
            (data as unknown as (WalletTransaction & { profile: { full_name: string } | null })[]).map((t) => ({
              ...t,
              member_name: t.profile?.full_name ?? 'Miembro',
            }))
          );
        } catch (err) {
          Alert.alert('Error inesperado al procesar las transferencias', err instanceof Error ? err.message : String(err));
        }
      }
      setIsLoading(false);
      setIsRefreshing(false);
    },
    [group]
  );

  // Refetches every time this screen gains focus (not just on first mount) —
  // otherwise a pending transaction submitted while the admin already had
  // this screen open earlier in the stack never appears without a pull-to-
  // refresh or a full app restart.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (groupLoading || isLoading || !group) {
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
      onRefresh={() => refresh({ silent: true })}
      refreshing={isRefreshing}
      ListEmptyComponent={<EmptyState title="Sin pendientes" description="No hay transferencias por confirmar." />}
      renderItem={({ item }) => (
        <PendingTransactionRow transaction={item} onDecided={() => refresh({ silent: true })} />
      )}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  row: { gap: spacing.sm },
  rowTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  rowSubtitle: { color: colors.textMuted },
  receipt: { width: '100%', height: 220, borderRadius: radii.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
