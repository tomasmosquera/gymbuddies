import { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useKothLeaderboard } from '@/hooks/useKothLeaderboard';
import { formatKothValue } from '@/lib/domain/koth';
import { colors, radii, spacing, typography } from '@/constants/theme';

export default function KingOfTheHillScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { entries, tally, isLoading, refresh } = useKothLeaderboard(group?.id ?? null);

  // This screen stays mounted across tab switches — without refetching on
  // focus, a claim submitted/resolved elsewhere (or via router.back() after
  // claiming) would keep showing stale state here until a manual re-entry.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (groupLoading || isLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtitle}>
        El récord de cada ejercicio se reclama con un video. Si nadie logra invalidarlo, queda en pie.
      </Text>

      {tally.length > 0 ? (
        <View>
          <Text style={styles.sectionLabel}>RANKING</Text>
          <Card style={styles.tallyCard}>
            {tally.map((entry, i) => (
              <View key={entry.userId} style={styles.tallyRow}>
                <Text style={styles.tallyRank}>{i + 1}</Text>
                <Text style={styles.tallyName} numberOfLines={1}>
                  {entry.fullName}
                </Text>
                <Text style={styles.tallyCount}>
                  {entry.count} {entry.count === 1 ? 'récord' : 'récords'}
                </Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <View>
        <Text style={styles.sectionLabel}>EJERCICIOS</Text>
        <View style={styles.list}>
          {entries.map(({ exercise, claim }) => (
            <Pressable
              key={exercise.id}
              style={styles.exerciseRow}
              onPress={() =>
                router.push({ pathname: '/profile/king-of-the-hill-exercise', params: { exerciseId: exercise.id } })
              }
            >
              <View style={styles.exerciseInfo}>
                <Text style={styles.exerciseName}>{exercise.name}</Text>
                {claim ? (
                  <Text style={styles.exerciseHolder} numberOfLines={1}>
                    {claim.fullName} — {formatKothValue(claim.metric_type, claim.value_canonical)}
                  </Text>
                ) : (
                  <Text style={styles.exerciseVacant}>Vacante — sé el primero</Text>
                )}
              </View>
              {claim?.status === 'pending_vote' ? <Badge label="En votación 🗳️" tone="warning" /> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted },
  sectionLabel: { color: colors.text, fontSize: 20, fontWeight: '700', letterSpacing: 0.3, marginBottom: spacing.sm },
  tallyCard: { gap: spacing.xs, padding: spacing.sm },
  tallyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.xs },
  tallyRank: { width: 20, color: colors.textMuted, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  tallyName: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 14 },
  tallyCount: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  list: { gap: spacing.sm },
  exerciseRow: {
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
  exerciseInfo: { flex: 1, gap: 2 },
  exerciseName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  exerciseHolder: { color: colors.textMuted, fontSize: 13 },
  exerciseVacant: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
});
