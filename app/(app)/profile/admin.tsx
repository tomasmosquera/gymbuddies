import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupMembers, type GroupMemberWithProfile } from '@/hooks/useGroupMembers';
import { useRuleProposal } from '@/hooks/useRuleProposal';
import { useGroupAdminOverview } from '@/hooks/useGroupAdminOverview';
import { supabase } from '@/lib/supabase/client';
import type { GroupMemberStatus } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

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

function ActionButton({ label, count, onPress }: { label: string; count?: number; onPress: () => void }) {
  return (
    <View style={styles.actionButtonWrapper}>
      <Button label={label} variant="secondary" onPress={onPress} />
      {count ? (
        <View style={styles.actionBadge}>
          <Text style={styles.actionBadgeText}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AdminGroupScreen() {
  const { session } = useAuth();
  const { group, isLoading: groupLoading, refresh: refreshGroup } = useActiveGroup();
  const { members, isLoading: membersLoading, refresh: refreshMembers } = useGroupMembers(group?.id ?? null);
  const { proposal, isLoading: proposalLoading, refresh: refreshProposal } = useRuleProposal(
    group?.id ?? null,
    session?.user.id ?? null
  );
  const { overview, isLoading: overviewLoading, refresh: refreshOverview } = useGroupAdminOverview(
    group?.id ?? null,
    group?.min_days_per_week ?? 0
  );
  const [isCancelling, setIsCancelling] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Refetches every time this screen gains focus — pending items, member
  // list, and stats submitted/changed elsewhere shouldn't need a pull-to-
  // refresh or app restart to show up here.
  useFocusEffect(
    useCallback(() => {
      refreshGroup();
      refreshMembers();
      refreshProposal();
      refreshOverview();
    }, [refreshGroup, refreshMembers, refreshProposal, refreshOverview])
  );

  if (groupLoading || membersLoading || proposalLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const handleCopyCode = async () => {
    await Clipboard.setStringAsync(group.invite_code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

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
          <Card style={styles.headerCard}>
            <View style={styles.headerRow}>
              <Text style={styles.groupName}>{group.name}</Text>
              <Button
                label="Editar"
                variant="secondary"
                onPress={() => router.push('/profile/admin-edit-group')}
              />
            </View>
            <View style={styles.inviteRow}>
              <View>
                <Text style={styles.cardTitle}>Código de invitación</Text>
                <Text style={styles.inviteCode}>{group.invite_code}</Text>
              </View>
              <Button label={codeCopied ? 'Copiado ✓' : 'Copiar'} variant="secondary" onPress={handleCopyCode} />
            </View>
          </Card>

          <Card style={styles.statsCard}>
            <Text style={styles.cardTitle}>Resumen del grupo</Text>
            {overviewLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
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
                  <Text style={styles.ruleLabel}>Multas cobradas en total</Text>
                  <Text style={styles.ruleValue}>
                    {group.currency} {overview.totalPenaltiesCharged.toLocaleString('es-CO')}
                  </Text>
                </View>
              </>
            )}
          </Card>

          <Card style={styles.statsCard}>
            <Text style={styles.cardTitle}>Cumplimiento esta semana</Text>
            {overviewLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : overview.weekCompliancePercent === null ? (
              <Text style={styles.rowSubtitle}>Nadie tiene días requeridos todavía esta semana.</Text>
            ) : (
              <>
                <ProgressBar progress={overview.weekCompliancePercent / 100} />
                <Text style={styles.progressLabel}>
                  {overview.weekCompliancePercent}% · {overview.weekCompletedDays} de {overview.weekRequiredDays} días
                  completados entre todo el grupo
                </Text>
              </>
            )}
          </Card>

          <Text style={styles.sectionTitle}>Pendientes por revisar</Text>
          <ActionButton
            label="Confirmar transferencias"
            count={overview.pendingTransactionsCount}
            onPress={() => router.push('/profile/admin-transactions')}
          />
          <ActionButton
            label="Revisar excusas"
            count={overview.pendingExcusesCount}
            onPress={() => router.push('/rules/excuse-admin')}
          />
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

          <Text style={styles.sectionTitle}>Herramientas</Text>
          <Button label="Moderar fotos de la semana" variant="secondary" onPress={() => router.push('/profile/admin-photos')} />
          <Button label="Asignar día válido/fallado" variant="secondary" onPress={() => router.push('/profile/admin-attendance')} />

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
  headerCard: { gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupName: { ...typography.heading, color: colors.text },
  inviteRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  inviteCode: { color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: 2 },
  statsCard: { gap: spacing.sm },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  statTile: { alignItems: 'center', flex: 1 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
  statValueWarning: { color: colors.danger },
  statLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2, textAlign: 'center' },
  progressLabel: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  sectionTitle: { ...typography.heading, color: colors.text, marginTop: spacing.sm },
  actionButtonWrapper: { position: 'relative' },
  actionBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  actionBadgeText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  row: { gap: spacing.sm },
  rowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: colors.text, fontWeight: '600' },
  rowSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  ruleRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  ruleLabel: { color: colors.textMuted },
  ruleValue: { color: colors.text, fontWeight: '600' },
  proposalCard: { gap: spacing.sm },
});
