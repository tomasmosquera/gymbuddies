import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { AvatarWithLevel } from '@/components/ui/AvatarWithLevel';
import type { LastClosedWeekSummary, LeaderboardPeriod, LeaderboardRow } from '@/hooks/useLeaderboard';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface LeaderboardCardProps {
  rowsByPeriod: Record<LeaderboardPeriod, LeaderboardRow[]>;
  lastClosedWeek: LastClosedWeekSummary | null;
  currentUserId: string | null;
  currency: string;
  /** Badge/XP level per member (see useGroupBadges) — shown as a bubble overlapping the avatar. */
  levelByUserId?: Record<string, number>;
  /** Shows a small inline spinner next to the title instead of ever unmounting the list. */
  isRefreshing?: boolean;
}

const PERIOD_OPTIONS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'all', label: 'Acumulado' },
];

function formatShortDate(dateString: string): string {
  const [, month, day] = dateString.split('-');
  return `${day}/${month}`;
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function LeaderboardCard({
  rowsByPeriod,
  lastClosedWeek,
  currentUserId,
  currency,
  levelByUserId,
  isRefreshing,
}: LeaderboardCardProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const rows = rowsByPeriod[period];

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Ranking del grupo</Text>
        {isRefreshing ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>

      {lastClosedWeek ? (
        <View style={styles.lastWeekBanner}>
          {lastClosedWeek.losers.length > 0 ? (
            <Text style={styles.lastWeekText}>
              La semana pasada ({formatShortDate(lastClosedWeek.weekStart)} - {formatShortDate(lastClosedWeek.weekEnd)}) no
              cumplió el mínimo: <Text style={styles.lastWeekNames}>{lastClosedWeek.losers.join(', ')}</Text>
            </Text>
          ) : (
            <Text style={styles.lastWeekText}>
              ¡Todo el grupo cumplió el mínimo la semana pasada ({formatShortDate(lastClosedWeek.weekStart)} -{' '}
              {formatShortDate(lastClosedWeek.weekEnd)})! 🎉
            </Text>
          )}
        </View>
      ) : null}

      <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.tableWrap}>
          <View style={styles.headerRow}>
            <View style={styles.rankSpacer} />
            <View style={styles.avatarSpacer} />
            <View style={styles.rowBodySpacer} />
            <Text style={styles.headerLabel}>✓</Text>
            <Text style={styles.headerLabel}>✗</Text>
            <Text style={styles.headerLabel}>%</Text>
          </View>
          <View style={styles.list}>
            {rows.map((row) => {
              const isMe = row.userId === currentUserId;
              return (
                <View key={row.userId} style={styles.row}>
                  <Text style={styles.rank}>{row.rank}</Text>
                  <AvatarWithLevel initials={getInitials(row.fullName)} level={levelByUserId?.[row.userId]} />
                  <View style={styles.rowBody}>
                    <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                      {row.fullName}
                      {isMe ? ' (tú)' : ''}
                    </Text>
                    <Text style={styles.owed}>
                      {row.chargedAmount > 0 ? `-${currency} ${row.chargedAmount.toLocaleString('es-CO')}` : `${currency} 0`}
                    </Text>
                  </View>
                  <Text style={[styles.stat, styles.statGood]}>{row.completedDays}</Text>
                  <Text style={[styles.stat, styles.statBad]}>{row.failedDays}</Text>
                  <Text style={[styles.stat, styles.statPercent]}>
                    {row.consistencyPercent !== null ? `${row.consistencyPercent}%` : '—'}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.heading, color: colors.text },
  lastWeekBanner: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  lastWeekText: { color: colors.textMuted, fontSize: 13 },
  lastWeekNames: { color: colors.text, fontWeight: '700' },
  tableWrap: { paddingBottom: 4, minWidth: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  rankSpacer: { width: 18 },
  avatarSpacer: { width: 32 },
  rowBodySpacer: { flex: 1, minWidth: 90 },
  headerLabel: { width: 42, color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { width: 18, color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  rowBody: { flex: 1, minWidth: 90 },
  name: { color: colors.text, fontWeight: '600' },
  nameMe: { color: colors.primary },
  owed: { color: colors.warning, fontSize: 12, marginTop: 1, fontWeight: '600' },
  stat: { width: 42, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  statGood: { color: colors.success },
  statBad: { color: colors.danger },
  statPercent: { color: colors.primary },
});
