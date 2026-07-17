import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { colors, spacing, typography } from '@/constants/theme';

export default function ProfileScreen() {
  const { profile, session, signOut } = useAuth();
  const { group, membership, isLoading } = useActiveGroup();

  if (isLoading || !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card>
        <Text style={styles.name}>{profile.full_name}</Text>
        <Text style={styles.email}>{session?.user.email}</Text>
        {profile.phone ? <Text style={styles.phone}>{profile.phone}</Text> : null}
      </Card>

      {group && membership ? (
        <Card>
          <Text style={styles.sectionTitle}>Grupo activo</Text>
          <Text style={styles.groupName}>{group.name}</Text>
          <Text style={styles.role}>{membership.role === 'admin' ? 'Administrador' : 'Miembro'}</Text>
        </Card>
      ) : null}

      <Button label="Cambiar de grupo" variant="secondary" onPress={() => router.push('/group-select')} />

      {membership?.role === 'admin' ? (
        <Button label="Administrar grupo" variant="secondary" onPress={() => router.push('/profile/admin')} />
      ) : null}

      <Button label="Cerrar sesión" variant="danger" onPress={signOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  name: { ...typography.heading, color: colors.text },
  email: { color: colors.textMuted, marginTop: 2 },
  phone: { color: colors.textMuted },
  sectionTitle: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  groupName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  role: { color: colors.textMuted, marginTop: 2 },
});
