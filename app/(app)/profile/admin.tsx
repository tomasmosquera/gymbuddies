import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupMembers, type GroupMemberWithProfile } from '@/hooks/useGroupMembers';
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

function MemberRow({ member }: { member: GroupMemberWithProfile }) {
  return (
    <Card style={styles.row}>
      <View>
        <Text style={styles.rowTitle}>
          {member.profile.full_name} {member.role === 'admin' ? '👑' : ''}
        </Text>
        <Text style={styles.rowSubtitle}>Saldo: {member.balance.toLocaleString('es-CO')}</Text>
      </View>
      <Badge label={STATUS_LABELS[member.status]} tone={STATUS_TONE[member.status]} />
    </Card>
  );
}

export default function AdminGroupScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { members, isLoading: membersLoading } = useGroupMembers(group?.id ?? null);

  if (groupLoading || membersLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

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
          <Text style={styles.sectionTitle}>Miembros ({members.length})</Text>
        </View>
      }
      renderItem={({ item }) => <MemberRow member={item} />}
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: colors.text, fontWeight: '600' },
  rowSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
