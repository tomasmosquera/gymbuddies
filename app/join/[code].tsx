import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase/client';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { usePendingInviteStore } from '@/state/pendingInviteStore';
import { normalizeInviteCode } from '@/lib/domain/inviteCode';
import { PAYOUT_MODE_LABELS } from '@/constants/payoutModes';
import type { GroupInvitePreviewRow } from '@/lib/supabase/types';
import { colors, spacing, typography } from '@/constants/theme';

/**
 * Universal/App Link target (https://<domain>/join/<code>) and the
 * destination useDeferredInviteCode routes to after a clipboard handoff.
 * Shows a public preview (get_group_invite_preview — groups_select RLS
 * requires membership, so a plain select can't do this for a non-member)
 * before actually joining, unlike the existing manual-code/QR flow in
 * app/(onboarding)/join-group.tsx, which auto-submits immediately — that
 * screen is left untouched, this is a deliberately separate entry point.
 */
export default function JoinInviteScreen() {
  const { code: rawCode } = useLocalSearchParams<{ code: string }>();
  const code = rawCode ? normalizeInviteCode(rawCode) : '';
  const { isSignedIn, isInitializing } = useAuth();
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const setPendingCode = usePendingInviteStore((s) => s.setPendingCode);
  const [preview, setPreview] = useState<GroupInvitePreviewRow | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!code) {
      setIsLoadingPreview(false);
      setNotFound(true);
      return;
    }
    (async () => {
      setIsLoadingPreview(true);
      const { data, error } = await supabase.rpc('get_group_invite_preview', { p_invite_code: code });
      if (cancelled) return;
      if (error || !data || data.length === 0) {
        setNotFound(true);
        setPendingCode(null);
      } else {
        setPreview(data[0]);
        setNotFound(false);
      }
      setIsLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleJoin = async () => {
    if (!isSignedIn) {
      setPendingCode(code);
      router.push('/sign-up');
      return;
    }
    setIsJoining(true);
    try {
      const { data, error } = await supabase.rpc('join_group', { p_invite_code: code });
      if (error || !data) throw new Error(error?.message ?? 'No se pudo unir al grupo');
      setPendingCode(null);
      setActiveGroupId(data.group_id);
      router.replace('/deposit');
    } catch (err) {
      Alert.alert('No se pudo unir al grupo', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsJoining(false);
    }
  };

  if (isInitializing || isLoadingPreview) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (notFound || !preview) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Invitación no válida</Text>
        <Text style={styles.subtitle}>Este código de invitación no existe o ya no es válido.</Text>
        <Button label="Volver" variant="secondary" onPress={() => router.replace('/')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <Text style={styles.eyebrow}>Te invitaron a un grupo</Text>
        <Text style={styles.groupName}>{preview.name}</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Miembros</Text>
          <Text style={styles.rowValue}>{preview.member_count}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Modo de juego</Text>
          <Text style={styles.rowValue}>{PAYOUT_MODE_LABELS[preview.payout_mode]}</Text>
        </View>
        {preview.payout_mode !== 'league' ? (
          <>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Días mínimos por semana</Text>
              <Text style={styles.rowValue}>{preview.min_days_per_week}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Penalización por día fallado</Text>
              <Text style={styles.rowValue}>
                {preview.currency} {preview.penalty_amount.toLocaleString('es-CO')}
              </Text>
            </View>
          </>
        ) : null}
      </Card>
      <Button label="Unirme al grupo" onPress={handleJoin} loading={isJoining} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.md,
  },
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, justifyContent: 'center', gap: spacing.lg },
  card: { gap: spacing.sm },
  eyebrow: { color: colors.textMuted, fontSize: 13 },
  groupName: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  rowLabel: { color: colors.textMuted },
  rowValue: { color: colors.text, fontWeight: '600' },
  title: { ...typography.heading, color: colors.text },
  subtitle: { color: colors.textMuted, textAlign: 'center' },
});
