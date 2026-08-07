import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { KothVideoModal } from '@/components/koth/KothVideoModal';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useKothCatalog } from '@/hooks/useKothCatalog';
import { useKothClaimHistory } from '@/hooks/useKothClaimHistory';
import { formatKothValue } from '@/lib/domain/koth';
import type { KothClaimStatus } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

const STATUS_INFO: Record<KothClaimStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  pending_vote: { label: 'En votación', tone: 'warning' },
  valid: { label: 'Válido', tone: 'success' },
  invalidated: { label: 'Invalidado', tone: 'danger' },
};

export default function KingOfTheHillExerciseScreen() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { exercises, isLoading: catalogLoading } = useKothCatalog();
  const { claims, isLoading: claimsLoading, refresh } = useKothClaimHistory(group?.id ?? null, exerciseId ?? null);
  const [viewingVideoPath, setViewingVideoPath] = useState<string | null>(null);

  // Stays mounted while navigating to the claim screen and back — without
  // refetching on focus, a just-submitted claim wouldn't show here until a
  // manual re-entry into the tab.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (groupLoading || catalogLoading || claimsLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const exercise = exercises.find((e) => e.id === exerciseId);
  if (!exercise) {
    return (
      <View style={styles.center}>
        <Text style={styles.subtitle}>Ejercicio no encontrado.</Text>
      </View>
    );
  }

  // Every accepted claim beat the previous record, so the most recent
  // non-invalidated, counting one is by construction the current champion —
  // same walk-back logic as refresh_koth_record() server-side. A practice
  // claim (counts_for_record false, submitted during its owner's protection
  // period) never was champion of anything, so it's excluded here too.
  const current = claims.find((c) => c.status !== 'invalidated' && c.counts_for_record) ?? null;

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{exercise.name}</Text>

        {current ? (
          <Card style={styles.currentCard}>
            <View style={styles.currentHeader}>
              <Text style={styles.currentLabel}>👑 Récord actual</Text>
              {current.status === 'pending_vote' ? <Badge label="En votación 🗳️" tone="warning" /> : null}
            </View>
            <Text style={styles.currentHolder}>{current.fullName}</Text>
            <Text style={styles.currentValue}>{formatKothValue(current.metric_type, current.value_canonical)}</Text>
            <Button label="Ver video" variant="secondary" onPress={() => setViewingVideoPath(current.video_path)} />
          </Card>
        ) : (
          <Card style={styles.currentCard}>
            <Text style={styles.vacantText}>Todavía nadie tiene el récord de este ejercicio. ¡Sé el primero!</Text>
          </Card>
        )}

        <Button
          label="Reclamar el trono"
          onPress={() =>
            router.push({ pathname: '/profile/king-of-the-hill-claim', params: { exerciseId: exercise.id } })
          }
        />

        {claims.length > 0 ? (
          <View>
            <Text style={styles.sectionLabel}>HISTORIAL</Text>
            <View style={styles.list}>
              {claims.map((claim) => {
                const statusInfo = STATUS_INFO[claim.status];
                return (
                  <View key={claim.id} style={styles.historyRow}>
                    <View style={styles.historyInfo}>
                      <Text style={styles.historyName} numberOfLines={1}>
                        {claim.fullName}
                      </Text>
                      <Text style={styles.historyValue}>
                        {formatKothValue(claim.metric_type, claim.value_canonical)}
                      </Text>
                      <Text style={styles.historyDate}>{new Date(claim.created_at).toLocaleDateString('es-CO')}</Text>
                    </View>
                    {claim.counts_for_record ? (
                      <Badge label={statusInfo.label} tone={statusInfo.tone} />
                    ) : (
                      <Badge label="Práctica" tone="neutral" />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <KothVideoModal
        visible={viewingVideoPath !== null}
        videoPath={viewingVideoPath}
        onClose={() => setViewingVideoPath(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  title: { ...typography.title, color: colors.text },
  currentCard: { gap: spacing.sm },
  currentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  currentLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  currentHolder: { ...typography.heading, color: colors.text },
  currentValue: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  vacantText: { color: colors.textMuted, fontStyle: 'italic' },
  sectionLabel: { color: colors.text, fontSize: 20, fontWeight: '700', letterSpacing: 0.3, marginBottom: spacing.sm },
  list: { gap: spacing.sm },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  historyInfo: { flex: 1, gap: 2 },
  historyName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  historyValue: { color: colors.textMuted, fontSize: 13 },
  historyDate: { color: colors.textMuted, fontSize: 11 },
});
