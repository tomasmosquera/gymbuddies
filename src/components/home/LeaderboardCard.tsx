import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import type { LeaderboardPeriod, LeaderboardRow } from '@/hooks/useLeaderboard';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface LeaderboardCardProps {
  rowsByPeriod: Record<LeaderboardPeriod, LeaderboardRow[]>;
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

export function LeaderboardCard({ rowsByPeriod, currentUserId, currency, isRefreshing }: LeaderboardCardProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const rows = rowsByPeriod[period];

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Ranking del grupo</Text>
        {isRefreshing ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      <View style={styles.headerRow}>
        <View style={styles.rankSpacer} />
        <View style={styles.avatarSpacer} />
        <View style={styles.rowBodySpacer} />
        <Text style={styles.headerLabel}>✓</Text>
        <Text style={styles.headerLabel}>✗</Text>
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
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.heading, color: colors.text },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  rankSpacer: { width: 18 },
  avatarSpacer: { width: 32 },
  rowBodySpacer: { flex: 1 },
  headerLabel: { flex: 1, color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
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
  rowBody: { flex: 1 },
  name: { color: colors.text, fontWeight: '600' },
  nameMe: { color: colors.primary },
  balance: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  stat: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  statGood: { color: colors.success },
  statBad: { color: colors.danger },
});
