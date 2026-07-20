import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupMembers, type GroupMemberWithProfile } from '@/hooks/useGroupMembers';
import { useRuleProposal } from '@/hooks/useRuleProposal';
import { supabase } from '@/lib/supabase/client';
import type { GroupMemberStatus } from '@/lib/supabase/types';
import { colors, spacing, typography } from '@/constants/theme';

const STATUS_LABELS: Record<GroupMemberStatus, string> = {
  pending_deposit: 'Sin depósito',
  active: 'Activo',
  needs_recharge: 'Necesita recarga',
  left: 'Se salió',
  removed: 'Removido',
};

const STATUS_TONE: Record<GroupMemberStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending_deposit: 'warning',
  active: 'success',
  needs_recharge: 'danger',
  left: 'neutral',
  removed: 'neutral',
};

function MemberRow({ member, onRemoved }: { member: GroupMemberWithProfile; onRemoved: () => void }) {
  const [isRemoving, setIsRemoving] = useState(false);
  const canRemove = member.role !== 'admin' && member.status !== 'removed';

  const confirmRemove = () => {
    Alert.alert(
      'Sacar del grupo',
      `¿Sacar a ${member.profile.full_name} del grupo? No podrá volver a entrar con el código de invitación.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sacar', style: 'destructive', onPress: handleRemove },
      ]
    );
  };

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      const { error } = await supabase.rpc('admin_remove_member', { p_member_id: member.id });
      if (error) throw new Error(error.message);
      onRemoved();
    } catch (err) {
      Alert.alert('No se pudo sacar al miembro', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Card style={styles.row}>
      <View style={styles.rowMain}>
        <View>
          <Text style={styles.rowTitle}>
            {member.profile.full_name} {member.role === 'admin' ? '👑' : ''}
          </Text>
          <Text style={styles.rowSubtitle}>Saldo: {member.balance.toLocaleString('es-CO')}</Text>
        </View>
        <Badge label={STATUS_LABELS[member.status]} tone={STATUS_TONE[member.status]} />
      </View>
      {canRemove ? (
        <Button label="Sacar del grupo" variant="danger" onPress={confirmRemove} loading={isRemoving} />
      ) : null}
    </Card>
  );
}

export default function AdminGroupScreen() {
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { members, isLoading: membersLoading, refresh: refreshMembers } = useGroupMembers(group?.id ?? null);
  const { proposal, isLoading: proposalLoading, refresh: refreshProposal } = useRuleProposal(
    group?.id ?? null,
    session?.user.id ?? null
  );
  const [isCancelling, setIsCancelling] = useState(false);

  if (groupLoading || membersLoading || proposalLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const confirmCancelProposal = () => {
    Alert.alert('Cancelar propuesta', '¿Cancelar la votación de cambio de reglas en curso?', [
      { text: 'No', style: 'cancel' },
      { text: 'Sí, cancelar', style: 'destructive', onPress: handleCancelProposal },
    ]);
  };

  const handleCancelProposal = async () => {
    if (!proposal) return;
    setIsCancelling(true);
    try {
      const { error } = await supabase.from('rule_proposals').update({ status: 'cancelled' }).eq('id', proposal.id);
      if (error) throw new Error(error.message);
      await refreshProposal();
    } catch (err) {
      Alert.alert('No se pudo cancelar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={members}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.lg }}>
          <Card>
            <Text style={styles.cardTitle}>Código de invitación</Text>
            <Text style={styles.inviteCode}>{group.invite_code}</Text>
          </Card>
          <Button
            label="Confirmar transferencias pendientes"
            onPress={() => router.push('/profile/admin-transactions')}
          />
          <Button label="Moderar fotos de la semana" variant="secondary" onPress={() => router.push('/profile/admin-photos')} />
          <Button label="Asignar día válido/fallado" variant="secondary" onPress={() => router.push('/profile/admin-attendance')} />
          {proposal ? (
            <Card style={styles.proposalCard}>
              <Text style={styles.cardTitle}>Votación de reglas en curso</Text>
              <Text style={styles.rowSubtitle}>Se necesitan {proposal.required_votes} votos a favor.</Text>
              <Button
                label="Cancelar propuesta"
                variant="danger"
                onPress={confirmCancelProposal}
                loading={isCancelling}
              />
            </Card>
          ) : null}
          <Text style={styles.sectionTitle}>Miembros ({members.length})</Text>
        </View>
      }
      renderItem={({ item }) => <MemberRow member={item} onRemoved={refreshMembers} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  cardTitle: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  inviteCode: { color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: 2 },
  sectionTitle: { ...typography.heading, color: colors.text },
  row: { gap: spacing.sm },
  rowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: colors.text, fontWeight: '600' },
  rowSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  proposalCard: { gap: spacing.sm },
});
