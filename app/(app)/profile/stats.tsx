import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { usePersonalStats } from '@/hooks/usePersonalStats';
import { usePersonalStatsV2, type PersonalStatsV2 } from '@/hooks/usePersonalStatsV2';
import { formatHour } from '@/lib/domain/personalStats';
import { BADGES } from '@/lib/domain/badges';
import { levelProgress } from '@/lib/domain/xp';
import type { MemberSummary } from '@/lib/domain/personalStatsV2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { AvatarWithLevel } from '@/components/ui/AvatarWithLevel';
import { LineChart } from '@/components/stats/LineChart';
import { Heatmap } from '@/components/stats/Heatmap';
import { BarList } from '@/components/stats/BarList';
import { VersusBar } from '@/components/stats/VersusBar';
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

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
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
  const { group, membership, isLoading: groupLoading } = useActiveGroup();
  const isAdminOnly = membership?.status === 'admin_only';
  // An admin_only viewer never has a records row of their own (they don't
  // play), so usePersonalStats (which requires finding "me" among the
  // group's active members) would never resolve for them — skip the fetch
  // entirely rather than spin forever waiting on data that can't exist.
  const { stats, isLoading: statsLoading } = usePersonalStats(
    isAdminOnly ? null : (group?.id ?? null),
    session?.user.id ?? null,
    group?.timezone ?? 'America/Bogota'
  );
  // Powers the sections merged in from the "Estadísticas V2" experiment
  // (Hero, Carrera, Cara a cara, Nivel y logros, King of the Hill) — kept as
  // its own hook/domain module rather than folded into usePersonalStats
  // above, so this large a change doesn't have to touch V1's own already-
  // working computation at all. Unlike usePersonalStats above, this one
  // still gets the real groupId for admin_only — it's also where
  // allMembers (the group-ranking table) comes from for them.
  const { data: statsV2, isLoading: statsV2Loading } = usePersonalStatsV2(
    group?.id ?? null,
    session?.user.id ?? null,
    group?.timezone ?? 'America/Bogota'
  );
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('month');
  const [versusIndex, setVersusIndex] = useState(0);
  const [showAllVersus, setShowAllVersus] = useState(false);

  if (groupLoading || statsV2Loading || !statsV2 || (!isAdminOnly && (statsLoading || !stats))) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (isAdminOnly) {
    return <AdminOnlyGroupStats data={statsV2} />;
  }
  if (!stats || !statsV2.me) {
    // Shouldn't happen — the loading guard above already required both —
    // just keeps the type-checker (and a stray render in between) honest.
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const durationUnit = ' min';
  const timesLabel = (n: number) => `${n} ${n === 1 ? 'vez' : 'veces'}`;
  const me = statsV2.me;
  const level = levelProgress(me.totalXp);
  const versusTeammate: MemberSummary | null = statsV2.teammates[versusIndex] ?? null;
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
  // Madrugada dropped from display only — checkinHourBuckets/averageCheckinHour
  // (the "Hora promedio" line above the bars) still see every check-in.
  const hourBuckets = stats.hourBuckets.filter((b) => b.label !== 'Madrugada');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* --- Hero --- */}
      <Card style={styles.heroCard}>
        <View style={styles.heroTop}>
          <AvatarWithLevel initials={getInitials(stats.fullName)} level={level.level} size={56} />
          <View style={styles.heroNameBlock}>
            <Text style={styles.heroName}>{stats.fullName}</Text>
            <Text style={styles.heroRank}>
              #{statsV2.myRank} de {statsV2.groupSize} en el grupo
            </Text>
          </View>
        </View>
        <View style={styles.heroStatsRow}>
          <StatTile label="GB Score" value={me.gbScore !== null ? `${me.gbScore}%` : '—'} />
          <StatTile label="Racha actual" value={`${me.currentStreak} 🔥`} />
          <StatTile label="Racha máxima" value={`${me.longestStreak}`} />
        </View>
      </Card>

      {/* --- Carrera (reemplaza Rachas — la racha ya se ve arriba, en el Hero) --- */}
      <View>
        <SectionLabel icon="trophy-outline">CARRERA</SectionLabel>
        <Card style={[styles.card, styles.tileRow]}>
          <StatTile label="Check-ins totales" value={`${me.totalCheckins}`} />
          {statsV2.requireCheckoutPhoto ? (
            <StatTile
              label="Horas entrenadas"
              value={me.totalMinutes !== null ? `${(me.totalMinutes / 60).toFixed(1)}h` : '—'}
            />
          ) : null}
          {me.totalCalories !== null ? (
            <StatTile label="Calorías (Apple Health)" value={`${me.totalCalories.toLocaleString('es-CO')}`} />
          ) : null}
          <StatTile label="Días como miembro" value={`${me.daysAsMember}`} />
        </Card>
      </View>

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
            items={hourBuckets.map((b) => ({
              label: b.label,
              ratio: hourBuckets.length > 0 ? b.count / Math.max(...hourBuckets.map((x) => x.count), 1) : 0,
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

      {/* --- Cara a cara --- */}
      <View>
        <SectionLabel icon="people-outline">CARA A CARA</SectionLabel>
        {statsV2.teammates.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.subtleText}>
              Todavía sos el único miembro activo — cuando se unan más, podrás compararte con ellos acá.
            </Text>
          </Card>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {statsV2.teammates.map((t, i) => (
                <Pressable
                  key={t.userId}
                  onPress={() => setVersusIndex(i)}
                  style={[styles.chip, i === versusIndex && styles.chipActive]}
                >
                  <Text style={[styles.chipText, i === versusIndex && styles.chipTextActive]} numberOfLines={1}>
                    {t.fullName}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {versusTeammate ? (
              <Card style={[styles.card, styles.versusCard]}>
                <VersusBar
                  label="GB Score"
                  mine={me.gbScore}
                  theirs={versusTeammate.gbScore}
                  theirName={versusTeammate.fullName}
                  format={(v) => `${v}%`}
                />
                <VersusBar
                  label="Constancia"
                  mine={me.consistencyPercent}
                  theirs={versusTeammate.consistencyPercent}
                  theirName={versusTeammate.fullName}
                  format={(v) => `${v}%`}
                />
                <VersusBar
                  label="Racha actual"
                  mine={me.currentStreak}
                  theirs={versusTeammate.currentStreak}
                  theirName={versusTeammate.fullName}
                  format={(v) => `${v}d`}
                />
                {showAllVersus ? (
                  <>
                    <VersusBar
                      label="Racha más larga"
                      mine={me.longestStreak}
                      theirs={versusTeammate.longestStreak}
                      theirName={versusTeammate.fullName}
                      format={(v) => `${v}d`}
                    />
                    {statsV2.requireCheckoutPhoto ? (
                      <VersusBar
                        label="Minutos promedio"
                        mine={me.avgMinutes}
                        theirs={versusTeammate.avgMinutes}
                        theirName={versusTeammate.fullName}
                        format={(v) => `${v} min`}
                      />
                    ) : null}
                    <VersusBar
                      label="Nivel"
                      mine={me.level}
                      theirs={versusTeammate.level}
                      theirName={versusTeammate.fullName}
                      format={(v) => `${v}`}
                    />
                    <VersusBar
                      label="Logros"
                      mine={me.earnedBadgesCount}
                      theirs={versusTeammate.earnedBadgesCount}
                      theirName={versusTeammate.fullName}
                      format={(v) => `${v}`}
                    />
                    <VersusBar
                      label="Penalizaciones totales"
                      mine={me.totalPenalties}
                      theirs={versusTeammate.totalPenalties}
                      theirName={versusTeammate.fullName}
                      format={(v) => formatMoney(v, statsV2.currency)}
                    />
                  </>
                ) : null}
                <Pressable onPress={() => setShowAllVersus((v) => !v)} hitSlop={8} style={styles.seeAllButton}>
                  <Text style={styles.seeAllButtonText}>{showAllVersus ? 'Ver menos' : 'Ver todas'}</Text>
                </Pressable>
              </Card>
            ) : null}
          </>
        )}
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

      {/* --- Nivel y logros --- */}
      <View>
        <SectionLabel icon="star-outline">NIVEL Y LOGROS</SectionLabel>
        <Card style={styles.card}>
          <View style={styles.levelRow}>
            <Text style={styles.levelNumber}>Nivel {level.level}</Text>
            <Text style={styles.subtleText}>
              {level.currentLevelXp} / {level.xpForNextLevel} XP
            </Text>
          </View>
          <ProgressBar progress={level.progress} />
          <Text style={[styles.subtleText, styles.levelFootnote]}>
            {me.earnedBadgesCount} / {BADGES.length} logros desbloqueados
          </Text>
          <Button label="Ver mis logros" variant="secondary" onPress={() => router.push('/profile/badges')} />
        </Card>
      </View>

      {/* --- King of the Hill --- */}
      <View>
        <SectionLabel icon="flame-outline">KING OF THE HILL</SectionLabel>
        <Card style={[styles.card, styles.tileRow]}>
          <StatTile label="Reclamaciones válidas" value={`${me.kothValidClaims}`} />
        </Card>
        <Button label="Ver King of the Hill" variant="secondary" onPress={() => router.push('/profile/king-of-the-hill')} />
      </View>
    </ScrollView>
  );
}

/**
 * What Estadísticas shows an admin_only viewer instead of the personal
 * screen above — they never have a records row of their own (they don't
 * play), so "mine vs group" has nothing to compare. This is the group's own
 * ranking instead: who's trained the most, who's got the best times, same
 * ask as "para poder ver quienes son los que más han entrenado, los de
 * mejores tiempos".
 */
function AdminOnlyGroupStats({ data }: { data: PersonalStatsV2 }) {
  const leaders = data.allMembers; // already sorted best GB Score first
  const firstName = (fullName: string) => fullName.split(' ')[0];
  const bestStreak = leaders.length > 0 ? leaders.reduce((a, b) => (b.currentStreak > a.currentStreak ? b : a)) : null;
  const mostCheckins = leaders.length > 0 ? leaders.reduce((a, b) => (b.totalCheckins > a.totalCheckins ? b : a)) : null;
  const timed = leaders.filter((m) => m.avgMinutes !== null);
  const bestAvgMinutes = data.requireCheckoutPhoto && timed.length > 0 ? timed.reduce((a, b) => (b.avgMinutes! > a.avgMinutes! ? b : a)) : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.subtleText}>Como administrador no participás — esta pantalla muestra el desempeño de todo el grupo.</Text>

      {leaders.length === 0 ? (
        <Card style={styles.card}>
          <Text style={styles.subtleText}>Todavía no hay miembros entrenando en este grupo.</Text>
        </Card>
      ) : (
        <>
          <View>
            <SectionLabel icon="trophy-outline">DESTACADOS</SectionLabel>
            <Card style={[styles.card, styles.tileRow]}>
              <StatTile
                label="Mejor GB Score"
                value={leaders[0].gbScore !== null ? `${firstName(leaders[0].fullName)} · ${leaders[0].gbScore}%` : '—'}
              />
              {bestStreak && bestStreak.currentStreak > 0 ? (
                <StatTile label="Mejor racha" value={`${firstName(bestStreak.fullName)} · ${bestStreak.currentStreak}d`} />
              ) : null}
              {mostCheckins && mostCheckins.totalCheckins > 0 ? (
                <StatTile label="Más check-ins" value={`${firstName(mostCheckins.fullName)} · ${mostCheckins.totalCheckins}`} />
              ) : null}
              {bestAvgMinutes ? (
                <StatTile label="Mejor promedio" value={`${firstName(bestAvgMinutes.fullName)} · ${bestAvgMinutes.avgMinutes} min`} />
              ) : null}
            </Card>
          </View>

          <View>
            <SectionLabel icon="podium-outline">RANKING DEL GRUPO</SectionLabel>
            <Card style={styles.card}>
              {leaders.map((m, i) => (
                <View key={m.userId} style={[styles.rankingRow, i > 0 && styles.rankingRowBorder]}>
                  <Text style={styles.rankingPosition}>{i + 1}</Text>
                  <Text style={styles.rankingName} numberOfLines={1}>
                    {m.fullName}
                  </Text>
                  <View style={styles.rankingStats}>
                    <Text style={styles.rankingStat}>{m.gbScore !== null ? `${m.gbScore}%` : '—'}</Text>
                    <Text style={styles.rankingStatMuted}>{m.currentStreak}🔥</Text>
                    <Text style={styles.rankingStatMuted}>{m.totalCheckins}✓</Text>
                    {data.requireCheckoutPhoto ? (
                      <Text style={styles.rankingStatMuted}>{m.avgMinutes !== null ? `${m.avgMinutes}min` : '—'}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          </View>
        </>
      )}
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
  tileRow: { flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap' },
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

  // Hero
  // Deliberately no custom backgroundColor — Card's default (colors.surface)
  // is what makes AvatarWithLevel's own default circle fill (surfaceAlt)
  // actually contrast and read as a circle, same as everywhere else it's
  // used (LeaderboardCard, Dashboard). Giving this card a matching
  // surfaceAlt background was exactly what swallowed the circle before.
  heroCard: { gap: spacing.md, borderWidth: 1, borderColor: colors.primary },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroNameBlock: { flex: 1 },
  heroName: { ...typography.heading, color: colors.text },
  heroRank: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 2 },
  heroStatsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },

  // Cara a cara
  chipRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.primaryText },
  versusCard: { gap: spacing.md },
  seeAllButton: { alignSelf: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  seeAllButtonText: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  // Nivel
  levelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  levelNumber: { color: colors.text, fontSize: 18, fontWeight: '700' },
  levelFootnote: { marginBottom: spacing.xs },

  // Admin_only's group ranking table
  rankingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  rankingRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rankingPosition: { width: 20, color: colors.textMuted, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  rankingName: { flex: 1, color: colors.text, fontWeight: '600', fontSize: 14 },
  rankingStats: { flexDirection: 'row', gap: spacing.sm },
  rankingStat: { color: colors.primary, fontSize: 13, fontWeight: '700', minWidth: 40, textAlign: 'right' },
  rankingStatMuted: { color: colors.textMuted, fontSize: 12, minWidth: 36, textAlign: 'right' },
});
