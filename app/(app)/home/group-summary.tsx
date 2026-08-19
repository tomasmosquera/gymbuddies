import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState } from '@/components/ui/EmptyState';
import { AvatarLevelRing } from '@/components/ui/AvatarLevelRing';
import { useAuth } from '@/hooks/useAuth';
import { useMyGroupsSummary, type MyGroupSummary } from '@/hooks/useMyGroupsSummary';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import type { LeaderboardPeriod } from '@/hooks/useLeaderboard';
import { colors, spacing, typography } from '@/constants/theme';

const PERIOD_OPTIONS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'all', label: 'Acumulado' },
];

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function GroupSummaryCard({
  summary,
  period,
  isActive,
  initials,
  onPress,
}: {
  summary: MyGroupSummary;
  period: LeaderboardPeriod;
  isActive: boolean;
  initials: string;
  onPress: () => void;
}) {
  const { membership, statsByPeriod, leaguePlace, leagueAmount, level } = summary;
  const group = membership.group;
  const stat = statsByPeriod?.[period] ?? null;

  return (
    <Pressable onPress={onPress}>
      <Card style={[styles.card, isActive && styles.cardActive]}>
        <View style={styles.cardTopRow}>
          <AvatarLevelRing initials={initials} level={level} size={56} ringWidth={3} />
          <View style={styles.cardTopInfo}>
            <View style={styles.headerRow}>
              <Text style={styles.groupName} numberOfLines={1}>
                {group.name}
              </Text>
              {isActive ? <Badge label="Actual" tone="success" /> : null}
            </View>
            {membership.status === 'pending_deposit' ? (
              <Badge label="Falta depósito" tone="warning" />
            ) : membership.status === 'needs_recharge' ? (
              <Badge label="Necesita recarga" tone="danger" />
            ) : null}
          </View>
        </View>

        {stat ? (
          <>
            <Text style={styles.positionText}>
              {stat.rank !== null ? `Posición #${stat.rank} de ${stat.activeMemberCount}` : 'Sin datos todavía'}
            </Text>
            <View style={styles.statsRow}>
              <View style={styles.statTile}>
                <Text style={[styles.statValue, styles.statGood]}>{stat.completedDays}</Text>
                <Text style={styles.statLabel}>✓</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={[styles.statValue, styles.statBad]}>{stat.failedDays}</Text>
                <Text style={styles.statLabel}>✗</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>{stat.consistencyPercent !== null ? `${stat.consistencyPercent}%` : '—'}</Text>
                <Text style={styles.statLabel}>%</Text>
              </View>
              <View style={styles.statTile}>
                <Text style={styles.statValue}>{stat.gbScore !== null ? `${stat.gbScore}%` : '—'}</Text>
                <Text style={styles.statLabel}>GB</Text>
              </View>
            </View>
          </>
        ) : null}

        {group.payout_mode === 'league' ? (
          <Text style={styles.leagueText}>
            Liga: {leaguePlace !== null ? `puesto ${leaguePlace} · ` : ''}
            {group.currency} {(leagueAmount ?? 0).toLocaleString('es-CO')}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function GroupSummaryScreen() {
  const { profile } = useAuth();
  const { summaries, isLoading, refresh } = useMyGroupsSummary();
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // A group switch elsewhere (Perfil, or picking a different group here)
  // shouldn't leave this screen showing stale numbers for whichever group
  // is now active if the user navigates back into it.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelect = (summary: MyGroupSummary) => {
    setActiveGroupId(summary.membership.group_id);
    router.replace(summary.membership.status === 'pending_deposit' ? '/deposit' : '/home');
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
      data={summaries}
      keyExtractor={(item) => item.membership.group_id}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.subtitle}>Toca un grupo para cambiarte a él.</Text>
          <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
        </View>
      }
      ListEmptyComponent={<EmptyState title="Sin grupos" description="Todavía no perteneces a ningún grupo." />}
      renderItem={({ item }) => (
        <GroupSummaryCard
          summary={item}
          period={period}
          isActive={item.membership.group_id === activeGroupId}
          initials={profile ? getInitials(profile.full_name) : '?'}
          onPress={() => handleSelect(item)}
        />
      )}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  header: { gap: spacing.md, marginBottom: spacing.md },
  subtitle: { color: colors.textMuted, fontSize: 13 },
  card: { gap: spacing.sm },
  cardActive: { borderColor: colors.primary },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTopInfo: { flex: 1, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  groupName: { ...typography.heading, color: colors.text, flexShrink: 1 },
  positionText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  statsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  statTile: { alignItems: 'center', width: 44 },
  statValue: { color: colors.text, fontWeight: '700', fontSize: 16 },
  statGood: { color: colors.success },
  statBad: { color: colors.danger },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  leagueText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
});
