import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { EmptyState } from '@/components/ui/EmptyState';
import { AvatarLevelRing } from '@/components/ui/AvatarLevelRing';
import { useAuth } from '@/hooks/useAuth';
import {
  useMyGroupsSummary,
  type MemberPeriodBreakdown,
  type MyGroupSummary,
  type SummaryPeriod,
} from '@/hooks/useMyGroupsSummary';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { colors, radii, spacing, typography } from '@/constants/theme';

const PERIOD_OPTIONS: { key: SummaryPeriod; label: string }[] = [
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'total', label: 'Acumulado' },
];

// Keyed off membership.status, not .role — the user may well be the admin
// (role: 'admin') in every single group they belong to, so a role-based
// filter would never actually narrow anything for them. What they want to
// tell apart is whether they personally play in a group at all: 'admin_only'
// (admin, doesn't play) vs. everything else (they do, whether or not they're
// also that group's admin).
type RoleFilter = 'all' | 'adminOnly' | 'player';

const ROLE_FILTER_OPTIONS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'adminOnly', label: 'Solo admin' },
  { key: 'player', label: 'Jugador' },
];

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** One player's initials + validos/fallados for the selected period — admin_only's replacement
 * for the position/✓/✗/%/GB row, which is all about the signed-in member's own attendance and
 * doesn't apply to someone who doesn't play in this group. */
function PlayerChip({ member }: { member: MemberPeriodBreakdown }) {
  return (
    <View style={styles.playerChip}>
      <View style={styles.playerAvatar}>
        <Text style={styles.playerAvatarText}>{getInitials(member.fullName)}</Text>
      </View>
      <Text style={styles.playerCounts}>
        <Text style={styles.playerCountGood}>{member.completedCount} ✓</Text>
        {'  '}
        <Text style={styles.playerCountBad}>{member.failedCount} ✗</Text>
      </Text>
    </View>
  );
}

function GroupSummaryCard({
  summary,
  period,
  isActive,
  initials,
  onPress,
}: {
  summary: MyGroupSummary;
  period: SummaryPeriod;
  isActive: boolean;
  initials: string;
  onPress: () => void;
}) {
  const { membership, statsByPeriod, position, leaguePlace, leagueAmount, level } = summary;
  const group = membership.group;
  const stat = statsByPeriod?.[period] ?? null;

  return (
    <Pressable onPress={onPress}>
      <Card style={[styles.card, isActive && styles.cardActive]}>
        <View style={styles.cardTopRow}>
          <AvatarLevelRing
            initials={initials}
            level={level}
            size={56}
            ringWidth={3}
            showLevel={membership.status !== 'admin_only'}
          />
          <View style={styles.cardTopInfo}>
            <View style={styles.headerRow}>
              <Text style={styles.groupName} numberOfLines={1}>
                {group.name}
              </Text>
              <View style={styles.headerBadges}>
                {membership.status === 'admin_only' ? <Badge label="Solo administras" /> : null}
                {isActive ? <Badge label="Actual" tone="success" /> : null}
              </View>
            </View>
            {membership.status === 'pending_deposit' ? (
              <Badge label="Falta depósito" tone="warning" />
            ) : membership.status === 'needs_recharge' ? (
              <Badge label="Necesita recarga" tone="danger" />
            ) : null}
          </View>
        </View>

        {/* An admin_only membership doesn't play here — "my" position/✓/✗/%/GB would always be
            empty/zero, which read as if the admin had a (bad) attendance record of their own.
            Each actual player's own initials + validos/fallados instead, same idea as stats.tsx's
            own AdminOnlyGroupStats branch. */}
        {membership.status === 'admin_only' ? (
          stat && stat.memberBreakdown.length > 0 ? (
            <View style={styles.playerChipRow}>
              {stat.memberBreakdown.map((member) => (
                <PlayerChip key={member.userId} member={member} />
              ))}
            </View>
          ) : null
        ) : (
          <>
            {stat ? (
              <>
                {/* Fixed regardless of which period tab is selected below — see
                    MyGroupSummary.position's doc comment for why. */}
                <Text style={styles.positionText}>
                  {position ? `Posición #${position.rank} de ${position.of}` : 'Sin datos todavía'}
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
          </>
        )}
      </Card>
    </Pressable>
  );
}

export default function GroupSummaryScreen() {
  const { profile } = useAuth();
  const { summaries, isLoading, refresh } = useMyGroupsSummary();
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);
  const [period, setPeriod] = useState<SummaryPeriod>('week');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filteredSummaries = summaries.filter((s) => {
    if (roleFilter === 'all') return true;
    const isAdminOnly = s.membership.status === 'admin_only';
    return roleFilter === 'adminOnly' ? isAdminOnly : !isAdminOnly;
  });

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
      data={filteredSummaries}
      keyExtractor={(item) => item.membership.group_id}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.subtitle}>Toca un grupo para cambiarte a él.</Text>
          <SegmentedControl options={ROLE_FILTER_OPTIONS} value={roleFilter} onChange={setRoleFilter} />
          <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          title="Sin grupos"
          description={summaries.length === 0 ? 'Todavía no perteneces a ningún grupo.' : 'No tienes grupos con ese filtro.'}
        />
      }
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
  headerBadges: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  groupName: { ...typography.heading, color: colors.text, flexShrink: 1 },
  positionText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  statsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  statTile: { alignItems: 'center', width: 44 },
  statValue: { color: colors.text, fontWeight: '700', fontSize: 16 },
  statGood: { color: colors.success },
  statBad: { color: colors.danger },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  leagueText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  playerChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  playerChip: { alignItems: 'center', width: 52, gap: 2 },
  playerAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerAvatarText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  playerCounts: { fontSize: 11, fontWeight: '700' },
  playerCountGood: { color: colors.success },
  playerCountBad: { color: colors.danger },
});
