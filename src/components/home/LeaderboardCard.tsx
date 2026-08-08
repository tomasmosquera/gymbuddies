import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { AvatarWithLevel } from '@/components/ui/AvatarWithLevel';
import { GB_SCORE_EXPLANATION_BODY, GB_SCORE_EXPLANATION_TITLE } from '@/lib/domain/attendance';
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
  /**
   * Set when Home's own week navigation (separate from this card's own
   * Semana/Mes/Acumulado tabs) is looking at a past week — rowsByPeriod.week
   * already reflects that week's data; this just labels it so "Semana"
   * doesn't silently look like it means "this week" when it doesn't.
   */
  viewedWeekLabel?: string | null;
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

function explainGbScore() {
  Alert.alert(GB_SCORE_EXPLANATION_TITLE, GB_SCORE_EXPLANATION_BODY);
}

export function LeaderboardCard({
  rowsByPeriod,
  lastClosedWeek,
  currentUserId,
  currency,
  levelByUserId,
  isRefreshing,
  viewedWeekLabel,
}: LeaderboardCardProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const rows = rowsByPeriod[period];

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Ranking del grupo</Text>
        {isRefreshing ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      <Pressable onPress={explainGbScore} hitSlop={8}>
        <Text style={styles.gbInfoLink}>ⓘ ¿Qué es el GB Score?</Text>
      </Pressable>
      {period === 'week' && viewedWeekLabel ? <Text style={styles.viewedWeekLabel}>Semana del {viewedWeekLabel}</Text> : null}

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
            <Text style={styles.headerLabel}>GB</Text>
          </View>
          <View style={styles.list}>
            {(() => {
              const rank1Count = rows.filter((r) => r.rank === 1).length;
              return rows.map((row) => {
                const isMe = row.userId === currentUserId;
                const isSoleMvp = row.rank === 1 && rank1Count === 1;
                return (
                  <View key={row.userId} style={styles.row}>
                    <Text style={[styles.rank, isSoleMvp && styles.rankMvp]}>{isSoleMvp ? 'MVP' : row.rank}</Text>
                    <AvatarWithLevel initials={getInitials(row.fullName)} level={levelByUserId?.[row.userId]} size={28} />
                    <View style={styles.rowBody}>
                      <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                        {row.fullName}
                        {isMe ? ' (tú)' : ''}
                      </Text>
                      <Text style={styles.owed} numberOfLines={1}>
                        {row.chargedAmount > 0 ? `-${currency} ${row.chargedAmount.toLocaleString('es-CO')}` : `${currency} 0`}
                      </Text>
                      {row.penaltyProtectedUntil ? (
                        <Text style={styles.protectedHint} numberOfLines={1}>
                          🛡️ Protegido hasta {formatShortDate(row.penaltyProtectedUntil)}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.stat, styles.statGood]}>{row.completedDays}</Text>
                    <Text style={[styles.stat, styles.statBad]}>{row.failedDays}</Text>
                    <Text style={[styles.stat, styles.statPercent]}>
                      {row.consistencyPercent !== null ? `${row.consistencyPercent}%` : '—'}
                    </Text>
                    <Text style={[styles.stat, styles.statGbScore]}>{row.gbScore !== null ? `${row.gbScore}%` : '—'}</Text>
                  </View>
                );
              });
            })()}
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
  gbInfoLink: { color: colors.textMuted, fontSize: 12, textDecorationLine: 'underline' },
  viewedWeekLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  lastWeekBanner: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  lastWeekText: { color: colors.textMuted, fontSize: 13 },
  lastWeekNames: { color: colors.text, fontWeight: '700' },
  tableWrap: { paddingBottom: 4, minWidth: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  rankSpacer: { width: 28 },
  avatarSpacer: { width: 28 },
  rowBodySpacer: { flex: 1, minWidth: 70 },
  headerLabel: { width: 38, color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { width: 28, color: colors.textMuted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  rankMvp: { color: colors.primary, fontSize: 11 },
  rowBody: { flex: 1, minWidth: 70 },
  name: { color: colors.text, fontWeight: '600' },
  nameMe: { color: colors.primary },
  owed: { color: colors.warning, fontSize: 12, marginTop: 1, fontWeight: '600' },
  protectedHint: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  stat: { width: 38, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  statGood: { color: colors.success },
  statBad: { color: colors.danger },
  statPercent: { color: colors.primary },
  statGbScore: { color: colors.text },
});
