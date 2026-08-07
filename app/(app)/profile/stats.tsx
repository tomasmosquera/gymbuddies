import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { usePersonalStats } from '@/hooks/usePersonalStats';
import { formatHour } from '@/lib/domain/personalStats';
import { Card } from '@/components/ui/Card';
import { LineChart } from '@/components/stats/LineChart';
import { Heatmap } from '@/components/stats/Heatmap';
import { BarList } from '@/components/stats/BarList';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { colors, radii, spacing, typography } from '@/constants/theme';

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatMonthLabel(month: string): string {
  const [, m] = month.split('-').map(Number);
  return MONTH_LABELS[m - 1];
}

function formatShortDate(dateString: string): string {
  const [, month, day] = dateString.split('-');
  return `${day}/${month}`;
}

function formatWeekLabel(weekStart: string): string {
  return formatShortDate(weekStart);
}

function formatDayLabel(date: string): string {
  return formatShortDate(date);
}

type TrendPeriod = 'day' | 'week' | 'month';

const TREND_PERIOD_OPTIONS: { key: TrendPeriod; label: string }[] = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
];

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString('es-CO')}`;
}

function SectionLabel({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={18} color={colors.text} />
      <Text style={styles.sectionLabel}>{children}</Text>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statTileValue}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

function ComparisonRow({ label, mine, group }: { label: string; mine: string; group: string }) {
  return (
    <View style={styles.comparisonRow}>
      <Text style={styles.comparisonLabel}>{label}</Text>
      <View style={styles.comparisonValues}>
        <View style={styles.comparisonValue}>
          <Text style={styles.comparisonValueText}>{mine}</Text>
          <Text style={styles.comparisonValueCaption}>Tú</Text>
        </View>
        <View style={styles.comparisonValue}>
          <Text style={[styles.comparisonValueText, styles.comparisonValueTextMuted]}>{group}</Text>
          <Text style={styles.comparisonValueCaption}>Grupo</Text>
        </View>
      </View>
    </View>
  );
}

export default function PersonalStatsScreen() {
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { stats, isLoading: statsLoading } = usePersonalStats(
    group?.id ?? null,
    session?.user.id ?? null,
    group?.timezone ?? 'America/Bogota'
  );
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('month');

  if (groupLoading || statsLoading || !stats) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const durationUnit = ' min';
  const timesLabel = (n: number) => `${n} ${n === 1 ? 'vez' : 'veces'}`;

  const trendXLabels =
    trendPeriod === 'day'
      ? stats.dailyConsistencySeries.map((d) => formatDayLabel(d.date))
      : trendPeriod === 'week'
        ? stats.weeklyConsistencySeries.map((w) => formatWeekLabel(w.weekStart))
        : stats.monthlyConsistencySeries.map((m) => formatMonthLabel(m.month));
  const trendConsistencyMine =
    trendPeriod === 'day'
      ? stats.dailyConsistencySeries.map((d) => d.percent)
      : trendPeriod === 'week'
        ? stats.weeklyConsistencySeries.map((w) => w.percent)
        : stats.monthlyConsistencySeries.map((m) => m.percent);
  const trendConsistencyGroup =
    trendPeriod === 'day'
      ? stats.dailyGroupConsistencySeries.map((d) => d.percent)
      : trendPeriod === 'week'
        ? stats.weeklyGroupConsistencySeries.map((w) => w.percent)
        : stats.monthlyGroupConsistencySeries.map((m) => m.percent);
  const durationXLabels =
    trendPeriod === 'day'
      ? stats.dailyDurationSeries.map((d) => formatDayLabel(d.date))
      : trendPeriod === 'week'
        ? stats.weeklyDurationSeries.map((w) => formatWeekLabel(w.weekStart))
        : stats.monthlyDurationSeries.map((m) => formatMonthLabel(m.month));
  const durationValuesMine =
    trendPeriod === 'day'
      ? stats.dailyDurationSeries.map((d) => d.avgMinutes)
      : trendPeriod === 'week'
        ? stats.weeklyDurationSeries.map((w) => w.avgMinutes)
        : stats.monthlyDurationSeries.map((m) => m.avgMinutes);
  const durationValuesGroup =
    trendPeriod === 'day'
      ? stats.dailyGroupDurationSeries.map((d) => d.avgMinutes)
      : trendPeriod === 'week'
        ? stats.weeklyGroupDurationSeries.map((w) => w.avgMinutes)
        : stats.monthlyGroupDurationSeries.map((m) => m.avgMinutes);
  // All three periods can have more points than fit legibly at once
  // (DAYS_TO_SHOW=60, WEEKS_TO_SHOW=24, MONTHS_TO_SHOW=12 in usePersonalStats)
  // — LineChart scrolls horizontally past visiblePoints, defaulted to the
  // most recent end.
  const trendVisiblePoints = trendPeriod === 'day' ? 10 : trendPeriod === 'week' ? 10 : 4;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View>
        <SectionLabel icon="trending-up-outline">TENDENCIA</SectionLabel>
        <View style={styles.trendToggle}>
          <SegmentedControl options={TREND_PERIOD_OPTIONS} value={trendPeriod} onChange={setTrendPeriod} />
        </View>
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>
            {trendPeriod === 'day' ? 'Consistencia día a día' : trendPeriod === 'week' ? 'Consistencia semana a semana' : 'Consistencia mes a mes'}
          </Text>
          <LineChart
            xLabels={trendXLabels}
            unit="%"
            visiblePoints={trendVisiblePoints}
            series={[
              { label: 'Tú', color: colors.primary, values: trendConsistencyMine },
              { label: 'Grupo', color: colors.warning, values: trendConsistencyGroup },
            ]}
          />
        </Card>
        {stats.requireCheckoutPhoto ? (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>{trendPeriod === 'day' ? 'Minutos de entreno' : 'Minutos promedio de entreno'}</Text>
            <LineChart
              xLabels={durationXLabels}
              unit=" min"
              visiblePoints={trendVisiblePoints}
              series={[
                { label: 'Tú', color: colors.primary, values: durationValuesMine },
                { label: 'Grupo', color: colors.warning, values: durationValuesGroup },
              ]}
            />
          </Card>
        ) : null}
      </View>

      <View>
        <SectionLabel icon="flame-outline">RACHAS</SectionLabel>
        <Card style={[styles.card, styles.tileRow]}>
          <StatTile label="Racha actual" value={`${stats.currentStreak} días`} />
          <StatTile label="Racha más larga" value={`${stats.longestStreak} días`} />
        </Card>
      </View>

      <View>
        <SectionLabel icon="bar-chart-outline">PATRONES</SectionLabel>
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Cumplimiento por día de la semana</Text>
          <BarList
            items={stats.weekdayRates.map((r) => ({
              label: r.label,
              ratio: (r.percent ?? 0) / 100,
              valueLabel: r.percent === null ? '—' : `${r.percent}%`,
              highlight: r.percent !== null && r.percent === Math.max(...stats.weekdayRates.map((x) => x.percent ?? -1)),
            }))}
          />
        </Card>
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Horario de check-in</Text>
          {stats.averageCheckinHour !== null ? (
            <Text style={styles.subtleText}>Hora promedio: {formatHour(stats.averageCheckinHour)}</Text>
          ) : null}
          <BarList
            items={stats.hourBuckets.map((b) => ({
              label: b.label,
              ratio: stats.hourBuckets.length > 0 ? b.count / Math.max(...stats.hourBuckets.map((x) => x.count), 1) : 0,
              valueLabel: `${b.count}`,
            }))}
          />
        </Card>
      </View>

      <View>
        <SectionLabel icon="calendar-outline">CALENDARIO</SectionLabel>
        <Card style={styles.card}>
          <Heatmap weeks={stats.heatmapWeeks} />
        </Card>
      </View>

      <View>
        <SectionLabel icon="people-outline">COMPARATIVA CON EL GRUPO</SectionLabel>
        <Card style={styles.card}>
          <ComparisonRow
            label="Consistencia"
            mine={stats.myConsistencyPercent !== null ? `${stats.myConsistencyPercent}%` : '—'}
            group={stats.groupAverageConsistencyPercent !== null ? `${stats.groupAverageConsistencyPercent}%` : '—'}
          />
          {stats.requireCheckoutPhoto ? (
            <ComparisonRow
              label="Minutos promedio"
              mine={stats.myAverageWorkoutMinutes !== null ? `${stats.myAverageWorkoutMinutes}${durationUnit}` : '—'}
              group={stats.groupAverageWorkoutMinutes !== null ? `${stats.groupAverageWorkoutMinutes}${durationUnit}` : '—'}
            />
          ) : null}
        </Card>
        <Card style={[styles.card, styles.tileRow]}>
          <StatTile label="Top del grupo" value={timesLabel(stats.timesTopDelGrupo)} />
          <StatTile label="Podio del mes" value={timesLabel(stats.timesPodio)} />
          <StatTile label="MVP semanal" value={timesLabel(stats.timesMvpWeek)} />
        </Card>
      </View>

      <View>
        <SectionLabel icon="ribbon-outline">RÉCORDS PERSONALES</SectionLabel>
        <Card style={[styles.card, styles.tileRow]}>
          {stats.requireCheckoutPhoto ? (
            <StatTile label="Entreno más largo" value={stats.longestWorkoutMinutes !== null ? `${stats.longestWorkoutMinutes} min` : '—'} />
          ) : null}
          <StatTile
            label="Mejor mes"
            value={stats.bestMonth ? `${formatMonthLabel(stats.bestMonth.month)} · ${stats.bestMonth.percent}%` : '—'}
          />
        </Card>
      </View>

      <View>
        <SectionLabel icon="cash-outline">FINANCIERO</SectionLabel>
        <Card style={styles.card}>
          <ComparisonRow
            label="Total en penalizaciones"
            mine={formatMoney(stats.myTotalPenalties, stats.currency)}
            group={formatMoney(stats.groupAverageTotalPenalties, stats.currency)}
          />
        </Card>
      </View>

      <View>
        <SectionLabel icon="chatbubbles-outline">SOCIAL</SectionLabel>
        <Card style={styles.card}>
          <View style={styles.tileRow}>
            <StatTile label="Reacciones dadas" value={`${stats.reactionsGivenTotal}`} />
            <StatTile label="Reacciones recibidas" value={`${stats.reactionsReceivedTotal}`} />
          </View>
          <View style={[styles.tileRow, styles.socialDivider]}>
            <StatTile
              label="Emoji más enviado"
              value={stats.mostSentEmoji ? `${stats.mostSentEmoji.emoji} ×${stats.mostSentEmoji.count}` : '—'}
            />
            <StatTile
              label="Emoji más recibido"
              value={stats.mostReceivedEmoji ? `${stats.mostReceivedEmoji.emoji} ×${stats.mostReceivedEmoji.count}` : '—'}
            />
          </View>
          {stats.mostReactedToByMe || stats.mostReactedToMe ? (
            <View style={styles.socialDivider}>
              {stats.mostReactedToByMe ? (
                <Text style={styles.socialLine}>
                  Reaccionas más a <Text style={styles.socialLineName}>{stats.mostReactedToByMe.fullName}</Text> (
                  {timesLabel(stats.mostReactedToByMe.count)})
                </Text>
              ) : null}
              {stats.mostReactedToMe ? (
                <Text style={styles.socialLine}>
                  Quien más te reacciona: <Text style={styles.socialLineName}>{stats.mostReactedToMe.fullName}</Text> (
                  {timesLabel(stats.mostReactedToMe.count)})
                </Text>
              ) : null}
            </View>
          ) : null}
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  trendToggle: { marginBottom: spacing.md },
  sectionLabel: { color: colors.text, fontSize: 20, fontWeight: '700', letterSpacing: 0.3 },
  card: { gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  subtleText: { color: colors.textMuted, fontSize: 12 },
  tileRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statTile: { alignItems: 'center', gap: 2 },
  statTileValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  statTileLabel: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  comparisonRow: { gap: spacing.xs },
  comparisonLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  comparisonValues: { flexDirection: 'row', gap: spacing.lg },
  comparisonValue: { alignItems: 'center', flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radii.md, paddingVertical: spacing.sm },
  comparisonValueText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  comparisonValueTextMuted: { color: colors.textMuted },
  comparisonValueCaption: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  socialDivider: { paddingTop: spacing.sm, marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  socialLine: { color: colors.textMuted, fontSize: 13 },
  socialLineName: { color: colors.text, fontWeight: '700' },
});
