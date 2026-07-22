import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { colors, spacing, typography } from '@/constants/theme';

export default function ProfileScreen() {
  const { profile, session, signOut } = useAuth();
  const { group, membership, isLoading, refresh } = useActiveGroup();
  const [isLeaving, setIsLeaving] = useState(false);

  if (isLoading || !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const hasPendingLeave = !!membership?.leave_effective_at;

  const confirmImmediateLeave = () => {
    if (!group) return;
    const feeText =
      group.exit_fee_amount > 0
        ? `Se te cobrará una cuota de salida de ${group.currency} ${group.exit_fee_amount.toLocaleString('es-CO')}.`
        : 'Este grupo no tiene cuota de salida configurada.';
    Alert.alert('Salir ahora', feeText, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir ahora', style: 'destructive', onPress: () => handleLeave(true) },
    ]);
  };

  const confirmNoticeLeave = () => {
    if (!group) return;
    Alert.alert(
      'Avisar salida',
      `Seguirás participando normalmente durante ${group.exit_notice_days} día(s) y luego saldrás sin costo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar aviso', onPress: () => handleLeave(false) },
      ]
    );
  };

  const handleLeave = async (immediate: boolean) => {
    if (!group) return;
    setIsLeaving(true);
    try {
      const { error } = await supabase.rpc('leave_group', { p_group_id: group.id, p_immediate: immediate });
      if (error) throw new Error(error.message);
      await refresh();
      if (immediate) router.replace('/group-select');
    } catch (err) {
      Alert.alert('No se pudo salir del grupo', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsLeaving(false);
    }
  };

  const handleCancelLeave = async () => {
    if (!group) return;
    setIsLeaving(true);
    try {
      const { error } = await supabase.rpc('cancel_leave_request', { p_group_id: group.id });
      if (error) throw new Error(error.message);
      await refresh();
    } catch (err) {
      Alert.alert('No se pudo cancelar el aviso', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsLeaving(false);
    }
  };

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

      {group && membership ? (
        <Card style={styles.walletCard}>
          <View style={styles.walletRow}>
            <View>
              <Text style={styles.sectionTitle}>Tu saldo</Text>
              <Text style={styles.balance}>
                {group.currency} {membership.balance.toLocaleString('es-CO')}
              </Text>
            </View>
            <Button label="Ver mi saldo" variant="secondary" onPress={() => router.push('/profile/wallet')} />
          </View>
        </Card>
      ) : null}

      <Button label="Cambiar de grupo" variant="secondary" onPress={() => router.push('/group-select')} />

      {membership?.role === 'admin' ? (
        <Button label="Administrar grupo" variant="secondary" onPress={() => router.push('/profile/admin')} />
      ) : null}

      {group && membership ? (
        <Card style={styles.leaveCard}>
          <Text style={styles.sectionTitle}>Salir del grupo</Text>
          {hasPendingLeave ? (
            <>
              <Text style={styles.role}>
                Saliste con aviso. Tu salida se hace efectiva el{' '}
                {new Date(membership.leave_effective_at!).toLocaleDateString('es-CO')}.
              </Text>
              <Button label="Cancelar aviso" variant="secondary" onPress={handleCancelLeave} loading={isLeaving} />
            </>
          ) : (
            <>
              <Button
                label={`Avisar salida (sin costo, ${group.exit_notice_days} día(s))`}
                variant="secondary"
                onPress={confirmNoticeLeave}
                loading={isLeaving}
              />
              <Button label="Salir ahora" variant="danger" onPress={confirmImmediateLeave} loading={isLeaving} />
            </>
          )}
        </Card>
      ) : null}

      <Card style={styles.accountCard}>
        <Text style={styles.sectionTitle}>Cuenta</Text>
        <Button label="Notificaciones y ubicación" variant="secondary" onPress={() => router.push('/profile/permissions')} />
        <Button label="Cambiar contraseña" variant="secondary" onPress={() => router.push('/profile/change-password')} />
        <Button label="Eliminar cuenta" variant="danger" onPress={() => router.push('/profile/delete-account')} />
      </Card>

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
  leaveCard: { gap: spacing.sm },
  walletCard: { gap: spacing.sm },
  walletRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balance: { ...typography.heading, color: colors.text, marginTop: 2 },
  accountCard: { gap: spacing.sm },
});
