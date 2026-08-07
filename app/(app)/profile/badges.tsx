import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupBadges, type MemberBadges } from '@/hooks/useGroupBadges';
import { BADGES, type BadgeCategory } from '@/lib/domain/badges';
import { MONTHLY_CHALLENGES } from '@/lib/domain/monthlyChallenges';
import { xpForBadge } from '@/lib/domain/xp';
import { Card } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { colors, radii, spacing, typography } from '@/constants/theme';

const CATEGORY_ORDER: BadgeCategory[] = ['racha', 'consistencia', 'fechas', 'checkins', 'financiero', 'social', 'koth'];

const CATEGORY_LABELS: Record<BadgeCategory, string> = {
  racha: 'RACHAS',
  consistencia: 'CONSISTENCIA',
  fechas: 'FECHAS ESPECIALES',
  checkins: 'CHECK-INS',
  financiero: 'FINANCIERO',
  social: 'SOCIAL',
  koth: 'KING OF THE HILL',
};

type ViewMode = 'historic' | 'monthly';

const VIEW_OPTIONS: { key: ViewMode; label: string }[] = [
  { key: 'historic', label: 'Logros Históricos' },
  { key: 'monthly', label: 'Logros del Mes' },
];

type UnlockFilter = 'all' | 'unlocked' | 'locked';

const FILTER_OPTIONS: { key: UnlockFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'unlocked', label: 'Desbloqueados' },
  { key: 'locked', label: 'Bloqueados' },
];

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function ProgressBar({ ratio, color, thin }: { ratio: number; color?: string; thin?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <View style={[styles.progressTrack, thin && styles.progressTrackThin]}>
      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color ?? colors.primary }]} />
    </View>
  );
}

function RankRow({
  rank,
  member,
  isSelf,
  isSelected,
  onPress,
}: {
  rank: number;
  member: MemberBadges;
  isSelf: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.rankRow, isSelected && styles.rankRowSelected]}>
      <Text style={styles.rankNumber}>{rank}</Text>
      <View style={styles.rankAvatar}>
        <Text style={styles.rankAvatarText}>{member.fullName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.rankInfo}>
        <Text style={styles.rankName} numberOfLines={1}>
          {member.fullName}
          {isSelf ? ' (tú)' : ''}
        </Text>
        <ProgressBar ratio={member.level.progress} thin />
      </View>
      <View style={styles.rankLevelBadge}>
        <Text style={styles.rankLevelText}>{member.level.level}</Text>
      </View>
    </Pressable>
  );
}

function BadgeRow({
  emoji,
  name,
  description,
  xpLabel,
  earned,
  ratio,
  statusText,
  statusTextHighlighted,
  secondaryStatusText,
}: {
  emoji: string;
  name: string;
  description: string;
  xpLabel: string;
  earned: boolean;
  ratio: number;
  statusText: string;
  /** Colors statusText independently of `earned` — defaults to `earned` when omitted. Monthly challenges need this: the bar reflects the current month, but the "conseguido x veces" text should stay highlighted once ever earned, regardless of this month's status. */
  statusTextHighlighted?: boolean;
  secondaryStatusText?: string;
}) {
  const highlightStatusText = statusTextHighlighted ?? earned;
  return (
    <View style={[styles.row, !earned && styles.rowUnearned]}>
      <Text style={[styles.rowEmoji, !earned && styles.rowEmojiDim]}>{emoji}</Text>
      <View style={styles.rowBody}>
        <View style={styles.rowHeaderLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.rowXpPill}>
            <Text style={styles.rowXpText}>{xpLabel}</Text>
          </View>
        </View>
        <Text style={styles.rowDescription} numberOfLines={2}>
          {description}
        </Text>
        <ProgressBar ratio={ratio} color={earned ? colors.success : colors.primary} thin />
        <View style={styles.rowStatusLine}>
          <Text style={highlightStatusText ? styles.rowEarned : styles.rowProgress}>{statusText}</Text>
          {secondaryStatusText ? <Text style={styles.rowSecondaryStatus}>{secondaryStatusText}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function BadgeListRow({ member, badgeId }: { member: MemberBadges; badgeId: string }) {
  const def = BADGES.find((b) => b.id === badgeId)!;
  const status = member.statuses[badgeId];
  const ratio = status.target > 0 ? status.current / status.target : 0;
  return (
    <BadgeRow
      emoji={def.emoji}
      name={def.name}
      description={def.description}
      xpLabel={`+${xpForBadge(badgeId)} XP`}
      earned={status.earned}
      ratio={ratio}
      statusText={status.earned ? '✓ Conseguido' : `${Math.min(status.current, status.target)}/${status.target}`}
    />
  );
}

function MonthlyChallengeRow({ member, challengeId }: { member: MemberBadges; challengeId: string }) {
  const def = MONTHLY_CHALLENGES.find((c) => c.id === challengeId)!;
  const status = member.monthlyStatuses[challengeId];
  // Only a monotonic challenge (a counter that only grows — see
  // MONTHLY_CHALLENGES' doc comment) can show as genuinely earned before the
  // month closes. A non-monotonic one (comparative/rank-based, or "no
  // failures/every week so far") can still flip by month's end — crediting
  // it from a live, still-open-month preview would trivially over-credit
  // early in the month (e.g. day 1's only checked-in member is trivially
  // "#1 in the group" or "most reacted-to", with nobody else to compare
  // against yet). Its real timesAchieved/XP already correctly waits for
  // month-close (see useGroupMonthlyChallenges' evalMonths); this only
  // affects the live preview shown here.
  const canShowLive = def.monotonic === true;
  const earnedThisMonth = canShowLive && status.currentMonthEarned === true;
  // Challenges with a real numeric threshold (e.g. 2 of 5 check-ins) get a
  // partial bar instead of only ever showing empty-or-full — see
  // MonthlyChallengeDefinition.progress for which monotonic challenges
  // qualify (a single-occurrence one like Empezamos Bien has no in-between
  // state worth showing).
  const progress = canShowLive ? status.currentMonthProgress : null;
  const ratio = progress ? Math.min(progress.current / progress.target, 1) : earnedThisMonth ? 1 : 0;
  return (
    <BadgeRow
      emoji={def.emoji}
      name={def.name}
      description={def.description}
      xpLabel={`+${def.xpPerOccurrence} XP c/u`}
      earned={earnedThisMonth}
      ratio={ratio}
      statusText={`Conseguido ${status.timesAchieved} ${status.timesAchieved === 1 ? 'vez' : 'veces'}`}
      statusTextHighlighted={status.timesAchieved > 0}
      secondaryStatusText={
        status.currentMonthEarned === null
          ? 'No aplica este mes'
          : canShowLive
            ? earnedThisMonth
              ? '✓ Este mes'
              : progress
                ? `${Math.min(progress.current, progress.target)}/${progress.target} este mes`
                : 'En curso este mes'
            : status.currentMonthEarned
              ? 'Vas bien — se define al cerrar el mes'
              : 'En curso este mes'
      }
    />
  );
}

export default function BadgesScreen() {
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { membersBadges, isLoading: badgesLoading } = useGroupBadges(group?.id ?? null, group?.timezone ?? 'America/Bogota');
  // Set when a notification about someone else's achievement was tapped
  // (see notificationRouting.ts) — opens straight on that member instead of
  // always defaulting to your own.
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(userIdParam ?? null);
  const [view, setView] = useState<ViewMode>('historic');
  const [filter, setFilter] = useState<UnlockFilter>('all');

  if (groupLoading || badgesLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const myBadges = membersBadges.find((m) => m.userId === session?.user.id) ?? null;
  const selected = membersBadges.find((m) => m.userId === selectedUserId) ?? myBadges ?? membersBadges[0] ?? null;
  const ranking = [...membersBadges].sort((a, b) => b.level.totalXp - a.level.totalXp);

  const matchesFilter = (earned: boolean) => filter === 'all' || (filter === 'unlocked' ? earned : !earned);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {myBadges ? (
        <View>
          <Card style={styles.levelCard}>
            <View style={styles.levelSummaryRow}>
              <Text style={styles.levelSummaryLevel}>Nivel {myBadges.level.level}</Text>
              <Text style={styles.levelSummaryXp}>
                {myBadges.level.currentLevelXp}/{myBadges.level.xpForNextLevel} XP
              </Text>
            </View>
            <ProgressBar ratio={myBadges.level.progress} />
          </Card>
        </View>
      ) : null}

      <View>
        <SectionLabel>RANKING</SectionLabel>
        <Text style={styles.subtitle}>Toca un jugador para ver sus logros.</Text>
        <Card style={styles.rankingCard}>
          {ranking.map((m, i) => (
            <RankRow
              key={m.userId}
              rank={i + 1}
              member={m}
              isSelf={m.userId === session?.user.id}
              isSelected={selected?.userId === m.userId}
              onPress={() => setSelectedUserId(m.userId)}
            />
          ))}
        </Card>
      </View>

      <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} size="lg" />
      <SegmentedControl options={FILTER_OPTIONS} value={filter} onChange={setFilter} />

      {selected && view === 'historic' ? (
        <>
          <View style={styles.overallSummary}>
            <Text style={styles.summary}>
              {selected.userId === session?.user.id ? 'Tus logros' : `Logros de ${selected.fullName}`}: {selected.earnedCount}/
              {BADGES.length}
            </Text>
            <ProgressBar ratio={selected.earnedCount / BADGES.length} />
          </View>

          {CATEGORY_ORDER.map((category) => {
            const categoryBadges = BADGES.filter((b) => b.category === category);
            const earnedInCategory = categoryBadges.filter((b) => selected.statuses[b.id].earned).length;
            const visibleBadges = categoryBadges.filter((b) => matchesFilter(selected.statuses[b.id].earned));
            return (
              <View key={category}>
                <View style={styles.categoryHeader}>
                  <SectionLabel>{CATEGORY_LABELS[category]}</SectionLabel>
                  <Text style={styles.categoryCount}>
                    {earnedInCategory}/{categoryBadges.length}
                  </Text>
                </View>
                <ProgressBar ratio={earnedInCategory / categoryBadges.length} thin />
                {visibleBadges.length > 0 ? (
                  <View style={styles.list}>
                    {visibleBadges.map((b) => (
                      <BadgeListRow key={b.id} member={selected} badgeId={b.id} />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.emptyFilterHint}>Nada que mostrar con este filtro.</Text>
                )}
              </View>
            );
          })}
        </>
      ) : null}

      {selected && view === 'monthly' ? (
        <View>
          <View style={styles.overallSummary}>
            <Text style={styles.summary}>
              {selected.userId === session?.user.id ? 'Tus logros' : `Logros de ${selected.fullName}`}:{' '}
              {MONTHLY_CHALLENGES.filter((c) => selected.monthlyStatuses[c.id].timesAchieved > 0).length}/{MONTHLY_CHALLENGES.length}
            </Text>
            <ProgressBar
              ratio={MONTHLY_CHALLENGES.filter((c) => selected.monthlyStatuses[c.id].timesAchieved > 0).length / MONTHLY_CHALLENGES.length}
            />
          </View>
          <Text style={[styles.subtitle, styles.monthlySubtitle]}>
            Se reinician cada mes — el contador suma cuántas veces los has conseguido.
          </Text>
          {(() => {
            // Unlike the lifetime "X/23" summary above, the filter tracks
            // this still-open month specifically — a challenge earned in a
            // past month but not (yet) this one belongs under "Bloqueados".
            // Same monotonic gate as the row's progress bar: a non-monotonic
            // challenge never counts as "Desbloqueado" from a live preview
            // alone, only once the month actually closes.
            const visibleChallenges = MONTHLY_CHALLENGES.filter((c) =>
              matchesFilter(c.monotonic === true && selected.monthlyStatuses[c.id].currentMonthEarned === true)
            );
            return visibleChallenges.length > 0 ? (
              <View style={styles.list}>
                {visibleChallenges.map((c) => (
                  <MonthlyChallengeRow key={c.id} member={selected} challengeId={c.id} />
                ))}
              </View>
            ) : (
              <Text style={styles.emptyFilterHint}>Nada que mostrar con este filtro.</Text>
            );
          })()}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.xs },
  monthlySubtitle: { marginBottom: spacing.md },
  levelCard: { gap: spacing.sm },
  levelSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  levelSummaryLevel: { ...typography.heading, fontSize: 20, color: colors.text },
  levelSummaryXp: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  rankingCard: { gap: spacing.xs, padding: spacing.sm },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xs,
    borderRadius: radii.md,
  },
  rankRowSelected: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  rankNumber: { width: 20, color: colors.textMuted, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  rankAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankAvatarText: { color: colors.text, fontWeight: '700' },
  rankInfo: { flex: 1, gap: 4 },
  rankName: { color: colors.text, fontWeight: '600', fontSize: 14 },
  rankLevelBadge: {
    minWidth: 30,
    height: 30,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  rankLevelText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
  overallSummary: { gap: spacing.xs },
  summary: { ...typography.heading, fontSize: 16, color: colors.text },
  sectionLabel: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  categoryCount: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  emptyFilterHint: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  progressTrack: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressTrackThin: { height: 5, marginBottom: spacing.xs },
  progressFill: { height: '100%', borderRadius: radii.pill },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  rowUnearned: { opacity: 0.5 },
  rowEmoji: { fontSize: 28, width: 36, textAlign: 'center' },
  rowEmojiDim: { opacity: 0.7 },
  rowBody: { flex: 1, gap: 2 },
  rowHeaderLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  rowName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  rowXpPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowXpText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  rowDescription: { color: colors.textMuted, fontSize: 12 },
  rowStatusLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowEarned: { color: colors.success, fontSize: 13, fontWeight: '700' },
  rowProgress: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  rowSecondaryStatus: { color: colors.textMuted, fontSize: 11 },
});
