import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupMembers, type GroupMemberWithProfile } from '@/hooks/useGroupMembers';
import { supabase } from '@/lib/supabase/client';
import type { WalletTransaction } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

function MemberPicker({
  members,
  selectedId,
  onSelect,
}: {
  members: GroupMemberWithProfile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.memberList}>
      {members.map((m) => {
        const isSelected = m.user_id === selectedId;
        return (
          <Pressable
            key={m.id}
            onPress={() => onSelect(m.user_id)}
            style={[styles.memberChip, isSelected && styles.memberChipSelected]}
          >
            <Text style={[styles.memberChipText, isSelected && styles.memberChipTextSelected]}>
              {m.profile.full_name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function AdminAdjustBalanceScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { members, isLoading: membersLoading } = useGroupMembers(group?.id ?? null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [adjustments, setAdjustments] = useState<WalletTransaction[]>([]);
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);

  const selectedMember = members.find((m) => m.user_id === selectedUserId) ?? null;

  const refreshAdjustments = useCallback(async () => {
    if (!group || !selectedUserId) {
      setAdjustments([]);
      return;
    }
    setAdjustmentsLoading(true);
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('group_id', group.id)
      .eq('user_id', selectedUserId)
      .eq('type', 'adjustment')
      .order('created_at', { ascending: false });
    if (!error && data) setAdjustments(data);
    setAdjustmentsLoading(false);
  }, [group, selectedUserId]);

  useEffect(() => {
    refreshAdjustments();
  }, [refreshAdjustments]);

  const handleSubmit = async (sign: 1 | -1) => {
    if (!group || !selectedUserId) return;
    const numeric = Number(amount);
    if (!amount || Number.isNaN(numeric) || numeric <= 0) {
      Alert.alert('Monto inválido', 'Ingresa un monto mayor a 0.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('admin_adjust_balance', {
        p_group_id: group.id,
        p_user_id: selectedUserId,
        p_amount: numeric * sign,
        p_note: note || null,
      });
      if (error) throw new Error(error.message);
      setAmount('');
      setNote('');
      await refreshAdjustments();
      Alert.alert('Listo', `Saldo ${sign > 0 ? 'aumentado' : 'disminuido'} correctamente.`);
    } catch (err) {
      Alert.alert('No se pudo ajustar el saldo', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (groupLoading || membersLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>
        Suma o resta un monto del saldo de cualquier jugador — por ejemplo, un pago en efectivo o una corrección.
      </Text>

      <Text style={styles.sectionLabel}>Jugador</Text>
      <MemberPicker members={members} selectedId={selectedUserId} onSelect={setSelectedUserId} />

      {selectedMember ? (
        <>
          <Card style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Saldo actual de {selectedMember.profile.full_name}</Text>
            <Text style={styles.balanceValue}>
              {group.currency} {selectedMember.balance.toLocaleString('es-CO')}
            </Text>
          </Card>

          <TextField
            label={`Monto (${group.currency})`}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
          />
          <TextField label="Nota (opcional)" value={note} onChangeText={setNote} multiline />

          <View style={styles.actionButtons}>
            <Button label="Sumar al saldo" onPress={() => handleSubmit(1)} loading={isSubmitting} />
            <Button label="Restar del saldo" variant="danger" onPress={() => handleSubmit(-1)} loading={isSubmitting} />
          </View>

          <Text style={styles.sectionLabel}>Ajustes anteriores</Text>
          {adjustmentsLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : adjustments.length === 0 ? (
            <Text style={styles.emptyText}>Sin ajustes todavía.</Text>
          ) : (
            adjustments.map((tx) => (
              <Card key={tx.id} style={styles.adjustmentRow}>
                <View>
                  <Text style={[styles.adjustmentAmount, tx.amount < 0 && styles.adjustmentAmountNegative]}>
                    {tx.amount > 0 ? '+' : ''}
                    {tx.amount.toLocaleString('es-CO')}
                  </Text>
                  {tx.note ? <Text style={styles.adjustmentNote}>{tx.note}</Text> : null}
                </View>
                <Text style={styles.adjustmentDate}>{new Date(tx.created_at).toLocaleDateString('es-CO')}</Text>
              </Card>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  sectionLabel: { ...typography.heading, fontSize: 15, color: colors.text, marginTop: spacing.sm },
  memberList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  memberChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  memberChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  memberChipText: { color: colors.textMuted, fontWeight: '600' },
  memberChipTextSelected: { color: colors.primaryText },
  balanceCard: { gap: spacing.xs },
  balanceLabel: { color: colors.textMuted, fontSize: 13 },
  balanceValue: { ...typography.title, color: colors.text },
  actionButtons: { flexDirection: 'row', gap: spacing.sm },
  emptyText: { color: colors.textMuted },
  adjustmentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  adjustmentAmount: { color: colors.success, fontWeight: '700' },
  adjustmentAmountNegative: { color: colors.danger },
  adjustmentNote: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  adjustmentDate: { color: colors.textMuted, fontSize: 12 },
});
