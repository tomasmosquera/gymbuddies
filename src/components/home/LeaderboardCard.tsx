import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { LastClosedWeekSummary, LeaderboardPeriod, LeaderboardRow } from '@/hooks/useLeaderboard';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface LeaderboardCardProps {
  rowsByPeriod: Record<LeaderboardPeriod, LeaderboardRow[]>;
  lastClosedWeek: LastClosedWeekSummary | null;
  currentUserId: string | null;
  currency: string;
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

export function LeaderboardCard({ rowsByPeriod, lastClosedWeek, currentUserId, currency, isRefreshing }: LeaderboardCardProps) {
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
        <View>
          <View style={styles.headerRow}>
            <View style={styles.rankSpacer} />
            <View style={styles.avatarSpacer} />
            <View style={styles.rowBodySpacer} />
            <Text style={styles.headerLabel}>✓</Text>
            <Text style={styles.headerLabel}>✗</Text>
            <Text style={styles.headerLabel}>%</Text>
            <Text style={styles.headerLabel}>💸</Text>
          </View>
          <View style={styles.list}>
            {rows.map((row, index) => {
              const isMe = row.userId === currentUserId;
              return (
                <View key={row.userId} style={styles.row}>
                  <Text style={styles.rank}>{index + 1}</Text>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{row.fullName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                      {row.fullName}
                      {isMe ? ' (tú)' : ''}
                    </Text>
                    <Text style={styles.balance}>
                      {currency} {row.balance.toLocaleString('es-CO')}
                    </Text>
                  </View>
                  <Text style={[styles.stat, styles.statGood]}>{row.completedDays}</Text>
                  <Text style={[styles.stat, styles.statBad]}>{row.failedDays}</Text>
                  <Text style={[styles.stat, styles.statPercent]}>
                    {row.consistencyPercent !== null ? `${row.consistencyPercent}%` : '—'}
                  </Text>
                  <Text style={[styles.stat, styles.statCharged]}>{row.chargedFailedDays}</Text>
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  rankSpacer: { width: 18 },
  avatarSpacer: { width: 32 },
  rowBodySpacer: { width: 90 },
  headerLabel: { width: 42, color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { width: 18, color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontWeight: '700' },
  rowBody: { width: 90 },
  name: { color: colors.text, fontWeight: '600' },
  nameMe: { color: colors.primary },
  balance: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  stat: { width: 42, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  statGood: { color: colors.success },
  statBad: { color: colors.danger },
  statPercent: { color: colors.primary },
  statCharged: { color: colors.warning },
});
