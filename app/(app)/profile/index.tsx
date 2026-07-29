import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useGroupBadges } from '@/hooks/useGroupBadges';
import { useNotifications } from '@/hooks/useNotifications';
import type { LevelProgress } from '@/lib/domain/xp';
import { supabase } from '@/lib/supabase/client';
import { colors, radii, spacing, typography } from '@/constants/theme';

const AVATAR_SIZE = 80;
const AVATAR_RING_WIDTH = 4;

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/** The avatar's green border becomes a ring that fills in with progress toward the next level. */
function AvatarWithLevel({ initials, level }: { initials: string; level: LevelProgress | null }) {
  const radius = (AVATAR_SIZE - AVATAR_RING_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = level?.progress ?? 0;
  const strokeDashoffset = circumference * (1 - progress);
  return (
    <View style={styles.avatarWrap}>
      <Svg width={AVATAR_SIZE} height={AVATAR_SIZE} style={StyleSheet.absoluteFill}>
        <Circle
          cx={AVATAR_SIZE / 2}
          cy={AVATAR_SIZE / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={AVATAR_RING_WIDTH}
          fill="none"
        />
        <Circle
          cx={AVATAR_SIZE / 2}
          cy={AVATAR_SIZE / 2}
          r={radius}
          stroke={colors.primary}
          strokeWidth={AVATAR_RING_WIDTH}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${AVATAR_SIZE / 2}, ${AVATAR_SIZE / 2}`}
        />
      </Svg>
      <View style={styles.avatarInner}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.levelBadge}>
        <Text style={styles.levelBadgeText}>{level?.level ?? 0}</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { profile, session, signOut } = useAuth();
  const { group, membership, isLoading, refresh } = useActiveGroup();
  const { rowsByPeriod, isLoading: leaderboardLoading } = useLeaderboard(group?.id ?? null);
  const { membersBadges } = useGroupBadges(group?.id ?? null);
  const { hasUnread: hasUnreadNotifications } = useNotifications();
  const [isLeaving, setIsLeaving] = useState(false);

  if (isLoading || !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const hasPendingLeave = !!membership?.leave_effective_at;
  const myWeekRow = rowsByPeriod.week.find((r) => r.userId === session?.user.id) ?? null;
  const myBadges = membersBadges.find((m) => m.userId === session?.user.id) ?? null;

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
      <View style={styles.topBar}>
        {group && membership ? (
          <Pressable onPress={() => router.push('/profile/invite')} style={styles.bellButton}>
            <Ionicons name="person-add-outline" size={24} color={colors.text} />
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable onPress={() => router.push('/profile/notifications')} style={styles.bellButton}>
          <Ionicons name="notifications-outline" size={24} color={colors.text} />
          {hasUnreadNotifications ? <View style={styles.bellDot} /> : null}
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Pressable onPress={() => router.push('/profile/badges')}>
          <AvatarWithLevel initials={getInitials(profile.full_name)} level={myBadges?.level ?? null} />
        </Pressable>
        <Pressable onPress={() => router.push('/profile/edit-profile')} style={styles.heroInfo}>
          <Text style={styles.name}>{profile.full_name}</Text>
          <Text style={styles.email}>{session?.user.email}</Text>
          {profile.phone ? <Text style={styles.phone}>{profile.phone}</Text> : null}
          <Text style={styles.editHint}>Toca para editar</Text>
        </Pressable>
      </View>

      {group && membership ? (
        <View>
          <SectionLabel>TU SALDO</SectionLabel>
          <Card style={styles.balanceCard}>
            <View style={styles.balanceRow}>
              <View>
                <Text style={styles.balance}>
                  {group.currency} {membership.balance.toLocaleString('es-CO')}
                </Text>
                <Text style={styles.balanceHint}>{group.name}</Text>
              </View>
              <Button label="Ver saldo" variant="secondary" onPress={() => router.push('/profile/wallet')} />
            </View>
            {myWeekRow ? (
              <View style={styles.weekStatsRow}>
                <View style={styles.weekStatTile}>
                  <Text style={[styles.weekStatValue, styles.weekStatGood]}>{myWeekRow.completedDays}</Text>
                  <Text style={styles.weekStatLabel}>días esta semana</Text>
                </View>
                <View style={styles.weekStatDivider} />
                <View style={styles.weekStatTile}>
                  <Text style={[styles.weekStatValue, styles.weekStatBad]}>{myWeekRow.failedDays}</Text>
                  <Text style={styles.weekStatLabel}>fallados</Text>
                </View>
                <View style={styles.weekStatDivider} />
                <View style={styles.weekStatTile}>
                  <Text style={[styles.weekStatValue, styles.weekStatPercent]}>
                    {myWeekRow.consistencyPercent !== null ? `${myWeekRow.consistencyPercent}%` : '—'}
                  </Text>
                  <Text style={styles.weekStatLabel}>consistencia</Text>
                </View>
              </View>
            ) : leaderboardLoading ? (
              <ActivityIndicator color={colors.primary} style={styles.weekStatsLoading} />
            ) : null}
          </Card>
        </View>
      ) : null}

      {group && membership ? (
        <View>
          <SectionLabel>TU GRUPO</SectionLabel>
          <Card style={styles.groupCard}>
            <View style={styles.groupRow}>
              <Text style={styles.groupName}>{group.name}</Text>
              <Badge
                label={membership.role === 'admin' ? 'Administrador' : 'Miembro'}
                tone={membership.role === 'admin' ? 'success' : 'neutral'}
              />
            </View>
            <View style={styles.groupActions}>
              <Button label="Cambiar de grupo" variant="secondary" onPress={() => router.push('/group-select')} />
              {membership.role === 'admin' ? (
                <Button label="Administrar grupo" variant="secondary" onPress={() => router.push('/profile/admin')} />
              ) : null}
            </View>
          </Card>
        </View>
      ) : null}

      {group && membership ? (
        <View>
          <SectionLabel>MI PROGRESO</SectionLabel>
          <Card style={styles.stackCard}>
            <Button label="Ver mis estadísticas" variant="secondary" onPress={() => router.push('/profile/stats')} />
            <Button label="Ver logros del grupo" variant="secondary" onPress={() => router.push('/profile/badges')} />
          </Card>
        </View>
      ) : null}

      <View>
        <SectionLabel>PREFERENCIAS</SectionLabel>
        <Card style={styles.stackCard}>
          <Button label="Notificaciones y ubicación" variant="secondary" onPress={() => router.push('/profile/permissions')} />
        </Card>
      </View>

      {group && membership ? (
        <View>
          <SectionLabel>SALIR DEL GRUPO</SectionLabel>
          <Card style={styles.stackCard}>
            {hasPendingLeave ? (
              <>
                <Text style={styles.hint}>
                  Saliste con aviso. Tu salida se hace efectiva el{' '}
                  {new Date(membership.leave_effective_at!).toLocaleDateString('es-CO')}.
                </Text>
                <Button label="Cancelar aviso" variant="secondary" onPress={handleCancelLeave} loading={isLeaving} />
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  Si avisas con {group.exit_notice_days} día(s) de anticipación, sigues participando con normalidad y
                  luego sales sin costo. Si sales ahora mismo
                  {group.exit_fee_amount > 0
                    ? `, se te cobra una cuota de ${group.currency} ${group.exit_fee_amount.toLocaleString('es-CO')}`
                    : ''}
                  .
                </Text>
                <Button
                  label={`Avisar salida (gratis en ${group.exit_notice_days} día(s))`}
                  variant="secondary"
                  onPress={confirmNoticeLeave}
                  loading={isLeaving}
                />
                <Button label="Salir ahora" variant="danger" onPress={confirmImmediateLeave} loading={isLeaving} />
              </>
            )}
          </Card>
        </View>
      ) : null}

      <View>
        <SectionLabel>ZONA DE RIESGO</SectionLabel>
        <Card style={styles.dangerCard}>
          <Text style={styles.dangerHint}>Esto elimina tu cuenta y tu historial permanentemente. No se puede deshacer.</Text>
          <Button label="Eliminar cuenta" variant="danger" onPress={() => router.push('/profile/delete-account')} />
        </Card>
      </View>

      <Button label="Cerrar sesión" variant="secondary" onPress={signOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', justifyContent: 'space-between' },
  bellButton: { padding: spacing.xs },
  bellDot: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  hero: { alignItems: 'center', gap: 2, marginBottom: spacing.xs },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginBottom: spacing.sm,
  },
  avatarInner: {
    position: 'absolute',
    top: AVATAR_RING_WIDTH + 3,
    left: AVATAR_RING_WIDTH + 3,
    right: AVATAR_RING_WIDTH + 3,
    bottom: AVATAR_RING_WIDTH + 3,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    minWidth: 26,
    height: 26,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  levelBadgeText: { color: colors.primaryText, fontSize: 12, fontWeight: '700' },
  avatarText: { color: colors.text, fontSize: 24, fontWeight: '700' },
  heroInfo: { alignItems: 'center', gap: 2 },
  name: { ...typography.heading, color: colors.text },
  email: { color: colors.textMuted, marginTop: 2 },
  phone: { color: colors.textMuted },
  editHint: { color: colors.primary, fontSize: 12, fontWeight: '600', marginTop: spacing.xs },
  sectionLabel: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: spacing.xs,
  },
  balanceCard: { gap: spacing.md },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balance: { ...typography.title, color: colors.text },
  balanceHint: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  weekStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  weekStatsLoading: { marginTop: spacing.sm },
  weekStatTile: { flex: 1, alignItems: 'center' },
  weekStatDivider: { width: 1, height: 28, backgroundColor: colors.border },
  weekStatValue: { fontSize: 20, fontWeight: '700' },
  weekStatGood: { color: colors.success },
  weekStatBad: { color: colors.danger },
  weekStatPercent: { color: colors.primary },
  weekStatLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2, textAlign: 'center' },
  groupCard: { gap: spacing.md },
  groupRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupName: { ...typography.heading, fontSize: 17, color: colors.text },
  groupActions: { gap: spacing.sm },
  stackCard: { gap: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 13 },
  dangerCard: { gap: spacing.sm, borderColor: colors.danger },
  dangerHint: { color: colors.textMuted, fontSize: 12 },
});
