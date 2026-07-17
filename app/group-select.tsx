import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useMyMemberships, type MembershipWithGroup } from '@/hooks/useMyMemberships';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { colors, spacing } from '@/constants/theme';

export default function GroupSelectScreen() {
  const { memberships, isLoading } = useMyMemberships();
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);

  const handleSelect = (membership: MembershipWithGroup) => {
    setActiveGroupId(membership.group_id);
    if (membership.status === 'pending_deposit') {
      router.replace('/deposit');
    } else {
      router.replace('/home');
    }
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
      data={memberships}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Pressable onPress={() => handleSelect(item)}>
          <Card style={[styles.row, item.group_id === activeGroupId && styles.rowActive]}>
            <View>
              <Text style={styles.groupName}>{item.group.name}</Text>
              <Text style={styles.role}>{item.role === 'admin' ? 'Administrador' : 'Miembro'}</Text>
            </View>
            {item.status === 'pending_deposit' ? <Badge label="Falta depósito" tone="warning" /> : null}
            {item.status === 'needs_recharge' ? <Badge label="Necesita recarga" tone="danger" /> : null}
          </Card>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      ListFooterComponent={
        <View style={styles.footer}>
          <Button label="Crear otro grupo" variant="secondary" onPress={() => router.push('/create-group')} />
          <Button label="Unirme con un código" variant="secondary" onPress={() => router.push('/join-group')} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowActive: { borderColor: colors.primary },
  groupName: { color: colors.text, fontWeight: '700', fontSize: 16 },
  role: { color: colors.textMuted, marginTop: 2 },
  footer: { gap: spacing.sm, marginTop: spacing.lg },
});
