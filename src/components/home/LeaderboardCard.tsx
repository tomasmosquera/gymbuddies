import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { AvatarWithLevel } from '@/components/ui/AvatarWithLevel';
import { GB_SCORE_EXPLANATION_BODY, GB_SCORE_EXPLANATION_TITLE } from '@/lib/domain/attendance';
import type { LastClosedWeekSummary, LeaderboardPeriod, LeaderboardRow } from '@/hooks/useLeaderboard';
import type { PayoutMode } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface LeaderboardCardProps {
  rowsByPeriod: Record<LeaderboardPeriod, LeaderboardRow[]>;
  lastClosedWeek: LastClosedWeekSummary | null;
  currentUserId: string | null;
  currency: string;
  /** Badge/XP level per member (see useGroupBadges) — shown as a bubble overlapping the avatar. */
  levelByUserId?: Record<string, number>;
  /** Total XP per member (see useGroupBadges) — tiebreaks members sharing the same rank, more XP first. Not level: two members on the same level still order by who's closer to the next one. */
  xpByUserId?: Record<string, number>;
  /** Shows a small inline spinner next to the title instead of ever unmounting the list. */
  isRefreshing?: boolean;
  /**
   * First load only — while true, shows a centered spinner instead of the
   * table. Every source below that can affect a row's rank/order (or the
   * MVP crown) resolves on its own schedule; rendering as each one trickles
   * in used to mean the visible order could resettle a moment after first
   * appearing — most noticeably League's Acumulado tab, which fell back to
   * GB Score's rank until leaguePlaceByUserId was ready, then re-sorted.
   * Unlike isRefreshing (a background poll, never worth unmounting the
   * list for), this is specifically for the one moment that matters most:
   * the very first render.
   */
  isInitialLoading?: boolean;
  /**
   * Set when Home's own week navigation (separate from this card's own
   * Semana/Mes/Acumulado tabs) is looking at a past week — rowsByPeriod.week
   * already reflects that week's data; this just labels it so "Semana"
   * doesn't silently look like it means "this week" when it doesn't.
   */
  viewedWeekLabel?: string | null;
  /** Only in League mode: what each member would get right now if the league ended today (see useLeaguePayoutPreview) — replaces the owed/charged line, since League never charges a penalty. Same number in every period tab (Semana/Mes/Acumulado) — it reflects current standing, not a period-scoped total. */
  payoutMode?: PayoutMode;
  leaguePayoutByUserId?: Record<string, number>;
  /** Only in League mode: tie-aware place from the same source as the money (liquidate_group_now) — drives the rank column and the MVP crown instead of GB Score's rank, so the number shown always matches who's actually winning what. */
  leaguePlaceByUserId?: Record<string, number>;
  /** League mode only, 0/undefined = descenso disabled. Marks the bottom N places as the relegation zone — same cycle-wide league place in every period tab (Semana/Mes/Acumulado), same idea as leaguePayoutByUserId above. A tie right at the boundary marks every tied member, same as the server does. */
  descensoRankCount?: number;
  descensoPenaltyAmount?: number;
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
  xpByUserId,
  isRefreshing,
  isInitialLoading,
  viewedWeekLabel,
  payoutMode,
  leaguePayoutByUserId,
  leaguePlaceByUserId,
  descensoRankCount,
  descensoPenaltyAmount,
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

      {isInitialLoading ? (
        <View style={styles.initialLoading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          {/* League mode never charges a penalty for missed days
              (0064_league_mode_no_penalty_and_game_start.sql — v_penalty is
              forced to 0 there), so this banner has nothing real to warn
              about in that mode — and the per-row ✗ column in the table right
              below already shows the same failed-days info per member without
              calling anyone out by name. Cooperative/mixed keep it: there, a
              failed day is a real penalty, worth a standalone callout. */}
          {lastClosedWeek && payoutMode !== 'league' ? (
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
                  // League mode's Acumulado tab ranks by the same tie-aware
                  // place the money itself comes from (liquidate_group_now) —
                  // falls back to GB Score's rank only while that data isn't
                  // available yet (e.g. the cycle just started, see
                  // useLeaguePayoutPreview). Semana/Mes keep GB Score's rank
                  // regardless of mode: they're about recent form over a
                  // period, not "who's actually winning the league right now"
                  // — that's what the money line (always cycle-wide) already
                  // answers on its own, independent of whichever tab is open.
                  const effectiveRank = (row: LeaderboardRow) =>
                    payoutMode === 'league' && period === 'all' ? (leaguePlaceByUserId?.[row.userId] ?? row.rank) : row.rank;
                  // Descenso is a cycle-wide standing, same idea as the money
                  // line above (leaguePayoutByUserId) — it has to read the same
                  // in Semana/Mes/Acumulado, not just when Acumulado happens to
                  // already be showing the league place. Unlike effectiveRank
                  // (which drives sort order and legitimately differs per tab),
                  // this always uses the league place regardless of which tab
                  // is open.
                  const leagueRank = (row: LeaderboardRow) => leaguePlaceByUserId?.[row.userId] ?? row.rank;
                  // Tied members (same rank, same MVP/podium spot) are ordered
                  // most-XP-first — the rank number itself never changes, this
                  // only decides who's listed first among equals. XP, not level:
                  // two members on the same level still order by who's actually
                  // closer to leveling up.
                  const sortedRows = [...rows].sort((a, b) => {
                    const rankDiff = effectiveRank(a) - effectiveRank(b);
                    if (rankDiff !== 0) return rankDiff;
                    const xpDiff = (xpByUserId?.[b.userId] ?? 0) - (xpByUserId?.[a.userId] ?? 0);
                    if (xpDiff !== 0) return xpDiff;
                    return a.fullName.localeCompare(b.fullName);
                  });
                  const rank1Count = sortedRows.filter((r) => effectiveRank(r) === 1).length;
                  return sortedRows.map((row) => {
                    const isMe = row.userId === currentUserId;
                    const rank = effectiveRank(row);
                    const isSoleMvp = rank === 1 && rank1Count === 1;
                    // Same tie-inclusive boundary the server uses for descenso:
                    // ties share a rank, so this naturally marks everyone tied
                    // at the cutoff without any extra merging logic here.
                    const isInDescensoZone =
                      payoutMode === 'league' &&
                      !!descensoRankCount &&
                      leagueRank(row) > sortedRows.length - descensoRankCount;
                    return (
                      <View key={row.userId} style={[styles.row, isInDescensoZone && styles.rowDescenso]}>
                        <Text style={[styles.rank, isSoleMvp && styles.rankMvp]}>{isSoleMvp ? 'MVP' : rank}</Text>
                        <AvatarWithLevel initials={getInitials(row.fullName)} level={levelByUserId?.[row.userId]} size={28} />
                        <View style={styles.rowBody}>
                          <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                            {row.fullName}
                            {isMe ? ' (tú)' : ''}
                          </Text>
                          {payoutMode === 'league' ? (
                            <Text style={styles.owed} numberOfLines={1}>
                              {currency} {(leaguePayoutByUserId?.[row.userId] ?? 0).toLocaleString('es-CO')}
                            </Text>
                          ) : (
                            <Text style={styles.owed} numberOfLines={1}>
                              {row.chargedAmount > 0 ? `-${currency} ${row.chargedAmount.toLocaleString('es-CO')}` : `${currency} 0`}
                            </Text>
                          )}
                          {row.penaltyProtectedUntil ? (
                            <Text style={styles.protectedHint} numberOfLines={1}>
                              🛡️ Protegido hasta {formatShortDate(row.penaltyProtectedUntil)}
                            </Text>
                          ) : null}
                          {isInDescensoZone ? (
                            <Text style={styles.descensoHint} numberOfLines={1}>
                              Zona de descenso
                              {descensoPenaltyAmount
                                ? ` — se cobrarán ${currency} ${descensoPenaltyAmount.toLocaleString('es-CO')}`
                                : ''}
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
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.heading, color: colors.text },
  gbInfoLink: { color: colors.textMuted, fontSize: 12, textDecorationLine: 'underline' },
  viewedWeekLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  initialLoading: { paddingVertical: spacing.xl, alignItems: 'center' },
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
  // Vertical/horizontal padding lives on every row (not just relegated
  // ones) so a highlighted row's background has room to breathe without
  // changing that row's height relative to its neighbors.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  // Translucent red wash, in addition to the "Zona de descenso" text —
  // colors.danger at low alpha so it reads as a highlight, not a solid fill.
  rowDescenso: { backgroundColor: 'rgba(255, 107, 107, 0.14)' },
  rank: { width: 28, color: colors.textMuted, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  rankMvp: { color: colors.primary, fontSize: 11 },
  rowBody: { flex: 1, minWidth: 70 },
  name: { color: colors.text, fontWeight: '600' },
  nameMe: { color: colors.primary },
  owed: { color: colors.warning, fontSize: 12, marginTop: 1, fontWeight: '600' },
  protectedHint: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  descensoHint: { color: colors.danger, fontSize: 11, marginTop: 1 },
  stat: { width: 38, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  statGood: { color: colors.success },
  statBad: { color: colors.danger },
  statPercent: { color: colors.primary },
  statGbScore: { color: colors.text },
});
