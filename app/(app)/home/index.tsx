import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { LeaderboardCard } from '@/components/home/LeaderboardCard';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useCheckins } from '@/hooks/useCheckins';
import { useExcusedDays } from '@/hooks/useExcusedDays';
import { useAttendanceOverrides } from '@/hooks/useAttendanceOverrides';
import { useElapsedSeconds } from '@/hooks/useElapsedSeconds';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useLeaguePayoutPreview } from '@/hooks/useLeaguePayoutPreview';
import { useGroupBadges } from '@/hooks/useGroupBadges';
import { useGroupDayAttendance, type MemberAttendance } from '@/hooks/useGroupDayAttendance';
import { supabase } from '@/lib/supabase/client';
import type { GroupCheckinWithProfile } from '@/hooks/useGroupWeekCheckins';
import { useArrivalReminderSync } from '@/hooks/useArrivalReminderSync';
import { useRuleProposal } from '@/hooks/useRuleProposal';
import { useExcuseVote } from '@/hooks/useExcuseVote';
import { usePhotoChallenges } from '@/hooks/usePhotoChallenges';
import { usePendingKothClaims } from '@/hooks/usePendingKothClaims';
import { useBuddyNudges } from '@/hooks/useBuddyNudges';
import { formatElapsedClock, getWeekBounds, toZonedDateString, weekDates } from '@/lib/domain/dateUtils';
import { CHECKIN_LOCATION_MISMATCH_METERS, distanceMeters } from '@/lib/domain/geo';
import { failsRemaining } from '@/lib/domain/walletState';
import { colors, radii, spacing, typography } from '@/constants/theme';

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export default function HomeScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading, refresh: refreshGroup } = useActiveGroup();
  const timezone = group?.timezone ?? 'America/Bogota';
  const [weekOffset, setWeekOffset] = useState(0);
  const isCurrentWeek = weekOffset === 0;
  const viewedDate = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const { weekCheckins: rawWeekCheckins, todayCheckin, isLoading: checkinsLoading, refresh: refreshCheckins } = useCheckins(
    group?.id ?? null,
    session?.user.id ?? null,
    timezone,
    viewedDate
  );
  const { weekExcusedDays: rawWeekExcusedDays, isLoading: excusedLoading } = useExcusedDays(
    group?.id ?? null,
    session?.user.id ?? null,
    timezone,
    viewedDate
  );
  const { weekOverrides: rawWeekOverrides, isLoading: overridesLoading, refresh: refreshOverrides } = useAttendanceOverrides(
    group?.id ?? null,
    session?.user.id ?? null,
    timezone,
    viewedDate
  );
  // These 3 hooks fetch raw rows with no awareness of the member's
  // activation date — a check-in/override/excuse from before they were
  // actually an accountable member (e.g. a backdated activation set by an
  // admin) shouldn't count here either, same rule useGroupAttendanceRecords
  // already applies everywhere else.
  const activatedDateString = membership
    ? toZonedDateString(new Date(membership.activated_at ?? membership.joined_at), timezone)
    : null;
  const weekCheckins = useMemo(
    () => (activatedDateString ? rawWeekCheckins.filter((c) => c.checkin_date >= activatedDateString) : rawWeekCheckins),
    [rawWeekCheckins, activatedDateString]
  );
  const weekExcusedDays = useMemo(
    () =>
      activatedDateString ? rawWeekExcusedDays.filter((e) => e.excused_date >= activatedDateString) : rawWeekExcusedDays,
    [rawWeekExcusedDays, activatedDateString]
  );
  const weekOverrides = useMemo(
    () =>
      activatedDateString ? rawWeekOverrides.filter((o) => o.override_date >= activatedDateString) : rawWeekOverrides,
    [rawWeekOverrides, activatedDateString]
  );
  const {
    rowsByPeriod,
    lastClosedWeek,
    isLoading: leaderboardLoading,
    refresh: refreshLeaderboard,
  } = useLeaderboard(group?.id ?? null, timezone, viewedDate);
  const {
    amountByUserId: leaguePayoutByUserId,
    placeByUserId: leaguePlaceByUserId,
    isLoading: leaguePayoutLoading,
    refresh: refreshLeaguePayout,
  } = useLeaguePayoutPreview(group?.id ?? null, group?.payout_mode ?? null);
  const { membersBadges, isLoading: badgesLoading } = useGroupBadges(group?.id ?? null, timezone);
  // Every source that can change a row's rank/order or the MVP crown —
  // gating the whole table on this (LeaderboardCard's isInitialLoading)
  // instead of rendering as each piece trickles in avoids the visible
  // reshuffle this used to cause (most noticeably League's Acumulado tab,
  // which initially fell back to GB Score's rank before leaguePlaceByUserId
  // was ready, then re-sorted to the real league place a moment later).
  const isRankingReady = !leaderboardLoading && !leaguePayoutLoading && !badgesLoading;
  const levelByUserId = useMemo(
    () => Object.fromEntries(membersBadges.map((m) => [m.userId, m.level.level])),
    [membersBadges]
  );
  // Tiebreak for the leaderboard's Ranking del grupo (same GB Score/rank) —
  // total XP, not level, so two members on the same level still order by
  // who's actually closer to leveling up next.
  const xpByUserId = useMemo(
    () => Object.fromEntries(membersBadges.map((m) => [m.userId, m.level.totalXp])),
    [membersBadges]
  );
  const { proposal, myVote: myRuleVote, refresh: refreshProposal } = useRuleProposal(
    group?.id ?? null,
    session?.user.id ?? null
  );
  const {
    request: excuseVoteRequest,
    myVote: myExcuseVote,
    refresh: refreshExcuseVote,
  } = useExcuseVote(group?.id ?? null, session?.user.id ?? null);
  const { challenges: openChallenges, refresh: refreshChallenges } = usePhotoChallenges(group?.id ?? null);
  const { claims: openKothClaims, refresh: refreshKothClaims } = usePendingKothClaims(group?.id ?? null);
  const [viewingPhotoPath, setViewingPhotoPath] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // "Did I check in today?" only from todayCheckin while actually viewing
  // the current week (see useCheckins.ts) — a past/future week's fetch
  // leaves todayCheckin stale/null, but that just means this render skips
  // refreshing the arrival-reminder cache, never wrongly clears it.
  useArrivalReminderSync(group?.id ?? null, session?.user.id ?? null, isCurrentWeek && !!todayCheckin);

  // Tabs stay mounted across switches, so returning to Home after taking a
  // photo (or voting elsewhere) never re-triggers each hook's mount-only
  // fetch on its own — without this, today's check-in step, the vote
  // banner, and the leaderboard could all sit stale until a manual
  // pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      refreshGroup();
      refreshCheckins();
      refreshOverrides();
      refreshLeaderboard();
      refreshLeaguePayout();
      refreshProposal();
      refreshExcuseVote();
      refreshChallenges();
      refreshKothClaims();
    }, [
      refreshGroup,
      refreshCheckins,
      refreshOverrides,
      refreshLeaderboard,
      refreshLeaguePayout,
      refreshProposal,
      refreshExcuseVote,
      refreshChallenges,
      refreshKothClaims,
    ])
  );

  const pendingVoteCount =
    (proposal && !myRuleVote ? 1 : 0) +
    (excuseVoteRequest && !myExcuseVote ? 1 : 0) +
    openChallenges.filter((c) => c.target_user_id !== session?.user.id && !c.votes.some((v) => v.user_id === session?.user.id))
      .length +
    openKothClaims.filter((c) => c.user_id !== session?.user.id && !c.votes.some((v) => v.user_id === session?.user.id))
      .length;

  // Nudge the member with a popup the moment there's something they haven't
  // voted on yet — once per app open (this tab stays mounted across tab
  // switches, so a mount here really does mean "just opened the app") and
  // again on every switch into a different group. Keyed on group id rather
  // than fired unconditionally so it doesn't re-pop on every background
  // refetch while the user is already looking at the vote.
  const votePopupShownForGroupRef = useRef<string | null>(null);
  useEffect(() => {
    if (!group?.id) return;
    if (pendingVoteCount === 0) return;
    if (votePopupShownForGroupRef.current === group.id) return;
    votePopupShownForGroupRef.current = group.id;
    Alert.alert(
      'Votación pendiente',
      'Hay una votación en curso en el grupo y todavía no has votado. Tu voto puede ser decisivo para el resultado.',
      [
        { text: 'Ahora no', style: 'cancel' },
        { text: 'Ir a votar', onPress: () => router.push('/rules') },
      ]
    );
  }, [group?.id, pendingVoteCount]);

  const todayString = toZonedDateString(new Date(), timezone);
  const { weekStart, weekEnd } = getWeekBounds(viewedDate, timezone);
  const days = useMemo(() => weekDates(weekStart), [weekStart]);

  // An admin_only member never checks in themselves, so their own week-dots
  // row is meaningless (always a wall of ✗). Swap it for the same per-day
  // breakdown Dashboard already computes, but per *member*, so a
  // non-participating admin can still see who trained at a glance without
  // leaving Home. Gated behind isAdminOnly (rather than always fetching) so
  // playing members don't pay for a query they never render.
  const isAdminOnly = membership?.status === 'admin_only';
  // Playing members can also pull this up on demand via "Ver todos" (below)
  // instead of it being admin_only-exclusive — same non-invasive toggle
  // idea as everywhere else on this screen (info links, week nav): opt-in,
  // collapsed by default, doesn't change what a playing member sees unless
  // they ask for it.
  const [showTeamView, setShowTeamView] = useState(false);
  const shouldLoadTeamWeek = isAdminOnly || showTeamView;
  const {
    members: teamWeekMembers,
    checkinsByDate: teamCheckinsByDate,
    isLoading: teamWeekLoading,
    refresh: refreshTeamWeek,
  } = useGroupDayAttendance(shouldLoadTeamWeek ? group?.id ?? null : null, weekStart, weekEnd, timezone);
  // Own effect (declared where refreshTeamWeek actually exists) rather than
  // folded into the big useFocusEffect above it — that one's callback is
  // defined before this hook runs, and this data only matters for
  // admin_only members anyway.
  useFocusEffect(
    useCallback(() => {
      refreshTeamWeek();
    }, [refreshTeamWeek])
  );

  // "Bud" — only relevant wherever the team view actually renders (same
  // gate as the team-week fetch above), so a playing member who never opens
  // "Ver todos" never pays for this either.
  const {
    canNudge,
    refresh: refreshNudges,
    sendNudge,
  } = useBuddyNudges(shouldLoadTeamWeek ? group?.id ?? null : null, timezone);
  useFocusEffect(
    useCallback(() => {
      refreshNudges();
    }, [refreshNudges])
  );
  const handleNudge = async (recipientId: string, recipientName: string) => {
    try {
      await sendNudge(recipientId);
      // The recipient gets the push — the sender gets this instead, so
      // tapping 👋🏼 doesn't just vanish with no feedback at all.
      Alert.alert('¡Bud enviado!', `Le enviaste un Bud a ${recipientName} para que se motive a ir hoy al gym.`);
    } catch (err) {
      Alert.alert('No se pudo avisar', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  // ✅ — the admin_only quick-validate column. Reuses the same
  // set_attendance_override RPC as "Asignar día válido/fallado" in
  // Administrar Miembros, just for today and with one tap, no evidence
  // required. If the player later uploads a real check-in for today, the
  // Dashboard shows their real photo/location/duration instead — see
  // adminValidatedByDate in useGroupDayAttendance.
  const handleValidate = async (memberId: string, memberName: string) => {
    if (!group) return;
    try {
      const { error } = await supabase.rpc('set_attendance_override', {
        p_group_id: group.id,
        p_user_id: memberId,
        p_date: todayString,
        p_status: 'valid',
      });
      if (error) throw new Error(error.message);
      await refreshTeamWeek();
      Alert.alert('Día validado', `Se validó el día de ${memberName} sin necesidad de foto.`);
    } catch (err) {
      Alert.alert('No se pudo validar', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const validOverrideDates = useMemo(
    () => new Set(weekOverrides.filter((o) => o.status === 'valid').map((o) => o.override_date)),
    [weekOverrides]
  );
  const failedOverrideDates = useMemo(
    () => new Set(weekOverrides.filter((o) => o.status === 'failed').map((o) => o.override_date)),
    [weekOverrides]
  );

  const completedCount = useMemo(() => {
    const dates = new Set(weekCheckins.map((c) => c.checkin_date));
    for (const d of validOverrideDates) dates.add(d);
    for (const d of failedOverrideDates) dates.delete(d);
    return dates.size;
  }, [weekCheckins, validOverrideDates, failedOverrideDates]);
  const excusedCount = weekExcusedDays.length;
  // Only the essentials gate the whole screen — week navigation and
  // pull-to-refresh should update their own cards in place, never blank out
  // everything else while a background fetch is in flight.
  const isWeekDataLoading = checkinsLoading || excusedLoading || overridesLoading;
  // Only ticking while there's an actual open workout to time — mirrors the
  // exact condition the "awaiting checkout" card below renders under.
  const awaitingCheckoutSince =
    isCurrentWeek && todayCheckin && group?.require_checkout_photo && !todayCheckin.checkout_captured_at
      ? todayCheckin.captured_at
      : null;
  const elapsedSeconds = useElapsedSeconds(awaitingCheckoutSince);

  if (groupLoading || !group || !membership) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const effectiveRequired = Math.max(group.min_days_per_week - excusedCount, 0);
  const progress = effectiveRequired > 0 ? Math.min(completedCount / effectiveRequired, 1) : 1;
  const remainingFails = failsRemaining(membership.balance, group.penalty_amount);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refreshGroup(),
        refreshCheckins(),
        refreshOverrides(),
        refreshLeaderboard(),
        refreshLeaguePayout(),
        refreshTeamWeek(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
    >
      <Pressable onPress={() => router.push('/home/group-summary')}>
        <Text style={styles.groupName}>{group.name} ›</Text>
        <Text style={styles.inviteCode}>Código: {group.invite_code}</Text>
      </Pressable>

      {pendingVoteCount > 0 ? (
        <Pressable onPress={() => router.push('/rules')}>
          <Card style={styles.voteBanner}>
            <Text style={styles.voteBannerText}>
              🗳️ Tienes {pendingVoteCount} votación{pendingVoteCount === 1 ? '' : 'es'} pendiente
              {pendingVoteCount === 1 ? '' : 's'} — toca para ir a votar
            </Text>
          </Card>
        </Pressable>
      ) : null}

      <Card style={styles.statusCard}>
        <View style={styles.statusRow}>
          <Text style={styles.balanceLabel}>Tu saldo</Text>
          <Badge
            label={membership.status === 'needs_recharge' ? 'Necesita recarga' : 'Activo'}
            tone={membership.status === 'needs_recharge' ? 'danger' : 'success'}
          />
        </View>
        <Text style={styles.balance}>
          {group.currency} {membership.balance.toLocaleString('es-CO')}
        </Text>
        {remainingFails !== null ? (
          <Text style={styles.hint}>Puedes fallar {remainingFails} día(s) más antes de necesitar recargar.</Text>
        ) : null}
        {membership.status === 'needs_recharge' ? (
          <Button label="Recargar saldo" variant="danger" onPress={() => router.push('/profile/wallet-recharge')} />
        ) : null}
      </Card>

      <Card>
        <View style={styles.weekNavRow}>
          <Pressable onPress={() => setWeekOffset((o) => o - 1)} style={styles.weekNavButton} hitSlop={8}>
            <Text style={styles.weekNavButtonText}>‹</Text>
          </Pressable>
          <View style={styles.weekTitleGroup}>
            <Text style={styles.cardTitle}>
              {isCurrentWeek
                ? 'Esta semana'
                : `${new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('es-CO')} - ${new Date(
                    `${weekEnd}T00:00:00Z`
                  ).toLocaleDateString('es-CO')}`}
            </Text>
            {isWeekDataLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          </View>
          <Pressable
            onPress={() => setWeekOffset((o) => Math.min(o + 1, 0))}
            style={[styles.weekNavButton, isCurrentWeek && styles.weekNavButtonDisabled]}
            disabled={isCurrentWeek}
            hitSlop={8}
          >
            <Text style={styles.weekNavButtonText}>›</Text>
          </Pressable>
        </View>
        {isAdminOnly ? (
          <TeamWeekRows
            days={days}
            todayString={todayString}
            isLoading={teamWeekLoading}
            members={teamWeekMembers}
            checkinsByDate={teamCheckinsByDate}
            currentUserId={session?.user.id ?? null}
            onPressPhoto={setViewingPhotoPath}
            isCurrentWeek={isCurrentWeek}
            canNudge={canNudge}
            onNudge={handleNudge}
            canValidate={isAdminOnly}
            onValidate={handleValidate}
          />
        ) : (
          <>
            <ProgressBar progress={progress} />
            <Text style={styles.progressLabel}>
              {completedCount} / {group.min_days_per_week} días
              {excusedCount > 0 ? ` (${excusedCount} excusado(s))` : ''}
            </Text>
            <View style={styles.weekRow}>
              {days.map((day, index) => {
                const checkinForDay = weekCheckins.find((c) => c.checkin_date === day);
                const isFailedOverride = failedOverrideDates.has(day);
                const isValidOverride = validOverrideDates.has(day);
                const isDone = (!!checkinForDay || isValidOverride) && !isFailedOverride;
                const isExcused = weekExcusedDays.some((e) => e.excused_date === day) && !isFailedOverride;
                const isToday = day === todayString;
                const isPast = day < todayString;
                // Days before the member's activation date weren't theirs to fail —
                // they weren't an accountable member of the group yet.
                const isBeforeMembership = activatedDateString !== null && day < activatedDateString;
                // Same precedence as classifyMemberDay (Dashboard/Ranking): a real
                // check-in wins over an excused day — excusing a day means you
                // don't have to train it, not that training it doesn't count.
                let tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral';
                if (isFailedOverride) tone = 'danger';
                else if (isDone) tone = 'success';
                else if (isExcused) tone = 'warning';
                else if (isPast && !isBeforeMembership) tone = 'danger';
                return (
                  <Pressable
                    key={day}
                    style={styles.dayColumn}
                    disabled={!checkinForDay}
                    onPress={() => checkinForDay && setViewingPhotoPath(checkinForDay.photo_path)}
                  >
                    <View style={[styles.dayDot, dayToneStyle(tone)]}>
                      <Text
                        style={[
                          styles.dayDotText,
                          tone === 'success' && styles.dayDotTextSuccess,
                          tone === 'danger' && styles.dayDotTextDanger,
                          tone === 'warning' && styles.dayDotTextWarning,
                        ]}
                      >
                        {tone === 'danger' ? '✗' : tone === 'success' ? '✓' : tone === 'warning' ? '–' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{DAY_LABELS[index]}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => setShowTeamView((v) => !v)}
              hitSlop={8}
              style={styles.seeAllButton}
              accessibilityRole="button"
            >
              <Text style={styles.seeAllButtonText}>{showTeamView ? 'Ocultar' : 'Ver todos'}</Text>
            </Pressable>

            {showTeamView ? (
              <View style={styles.teamSection}>
                <TeamWeekRows
                  days={days}
                  todayString={todayString}
                  isLoading={teamWeekLoading}
                  members={teamWeekMembers}
                  checkinsByDate={teamCheckinsByDate}
                  currentUserId={session?.user.id ?? null}
                  onPressPhoto={setViewingPhotoPath}
                  isCurrentWeek={isCurrentWeek}
                  canNudge={canNudge}
                  onNudge={handleNudge}
                  canValidate={false}
                  onValidate={handleValidate}
                />
              </View>
            ) : null}
          </>
        )}
      </Card>

      {membership.status === 'admin_only' ? (
        <Card style={styles.doneCard}>
          <Text style={styles.doneText}>Solo administras este grupo — no participas ni haces check-in.</Text>
        </Card>
      ) : isCurrentWeek && !todayCheckin ? (
        <Button
          label={group.require_checkout_photo ? 'Foto inicial 📸' : 'Hacer check-in de hoy 📸'}
          onPress={() => router.push('/checkin')}
        />
      ) : isCurrentWeek && todayCheckin && group.require_checkout_photo && !todayCheckin.checkout_captured_at ? (
        <Card style={styles.doneCard}>
          <View style={styles.stepsRow}>
            <View style={styles.stepPill}>
              <Text style={styles.stepPillText}>1. Foto Inicial ✓</Text>
            </View>
            <Text style={styles.stepsArrow}>→</Text>
            <View style={[styles.stepPill, styles.stepPillPending]}>
              <Text style={styles.stepPillText}>2. Foto Final</Text>
            </View>
          </View>
          {elapsedSeconds !== null ? (
            <Text style={styles.elapsedTimer}>{formatElapsedClock(elapsedSeconds)}</Text>
          ) : null}
          <Text style={styles.hint}>Cuando termines de entrenar, toma tu foto final para que cuente la duración.</Text>
          <Button label="Tomar Foto Final" onPress={() => router.push('/checkin')} />
        </Card>
      ) : isCurrentWeek && todayCheckin ? (
        <Card style={styles.doneCard}>
          {group.require_checkout_photo && todayCheckin.checkout_captured_at ? (
            <View style={styles.stepsRow}>
              <View style={styles.stepPill}>
                <Text style={styles.stepPillText}>1. Foto Inicial ✓</Text>
              </View>
              <Text style={styles.stepsArrow}>→</Text>
              <View style={styles.stepPill}>
                <Text style={styles.stepPillText}>2. Foto Final ✓</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.doneText}>Ya hiciste check-in hoy ✓</Text>
          )}
          {group.require_checkout_photo && todayCheckin.checkout_captured_at ? (
            <View style={styles.workoutInfo}>
              <Text style={styles.workoutMinutes}>Entrenaste {todayCheckin.workout_minutes} minuto(s)</Text>
              {todayCheckin.workout_minutes !== null && todayCheckin.workout_minutes < group.min_workout_minutes ? (
                <Badge label="Corto" tone="warning" />
              ) : null}
              {todayCheckin.checkout_latitude !== null &&
              todayCheckin.checkout_longitude !== null &&
              distanceMeters(
                todayCheckin.latitude,
                todayCheckin.longitude,
                todayCheckin.checkout_latitude,
                todayCheckin.checkout_longitude
              ) > CHECKIN_LOCATION_MISMATCH_METERS ? (
                <Badge label="Ubicación distinta" tone="warning" />
              ) : null}
            </View>
          ) : null}
          <View style={styles.doneActions}>
            <Button label="Ver mi foto" variant="secondary" onPress={() => setViewingPhotoPath(todayCheckin.photo_path)} />
            <Button label="Volver a tomar la foto" variant="secondary" onPress={() => router.push('/checkin')} />
          </View>
        </Card>
      ) : null}

      <CheckinPhotoModal
        visible={viewingPhotoPath !== null}
        photoPath={viewingPhotoPath}
        onClose={() => setViewingPhotoPath(null)}
      />

      <LeaderboardCard
        rowsByPeriod={rowsByPeriod}
        lastClosedWeek={lastClosedWeek}
        currentUserId={session?.user.id ?? null}
        currency={group.currency}
        levelByUserId={levelByUserId}
        xpByUserId={xpByUserId}
        isRefreshing={leaderboardLoading}
        isInitialLoading={!isRankingReady}
        payoutMode={group.payout_mode}
        leaguePayoutByUserId={leaguePayoutByUserId}
        leaguePlaceByUserId={leaguePlaceByUserId}
        descensoRankCount={group.descenso_rank_count}
        descensoPenaltyAmount={group.descenso_penalty_amount}
        viewedWeekLabel={
          isCurrentWeek
            ? null
            : `${new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('es-CO')} - ${new Date(
                `${weekEnd}T00:00:00Z`
              ).toLocaleDateString('es-CO')}`
        }
      />

      {membership.status !== 'admin_only' ? (
        <Button
          label="Solicitar excusa (viaje, médica u otra)"
          variant="secondary"
          onPress={() => router.push('/rules/excuse-request')}
        />
      ) : null}
    </ScrollView>
  );
}

/**
 * The per-member week table — a header row of weekday letters plus one row
 * per member with 7 status dots. Always shown for admin_only (their own row
 * would just be a wall of ✗, so this replaces it outright); shown behind
 * "Ver todos" for everyone else, so it's opt-in rather than pushed on every
 * playing member by default.
 */
function TeamWeekRows({
  days,
  todayString,
  isLoading,
  members,
  checkinsByDate,
  currentUserId,
  onPressPhoto,
  isCurrentWeek,
  canNudge,
  onNudge,
  canValidate,
  onValidate,
}: {
  days: string[];
  todayString: string;
  isLoading: boolean;
  members: MemberAttendance[];
  checkinsByDate: Map<string, GroupCheckinWithProfile[]>;
  currentUserId: string | null;
  onPressPhoto: (photoPath: string) => void;
  /** "Bud" only ever makes sense for today — nudging someone about a day already in the past is meaningless, so it's hidden entirely outside the current week's view (same value regardless of which week's dots happen to be on screen). */
  isCurrentWeek: boolean;
  /** "Bud" — whether Bud would actually let me nudge this person right now (see useBuddyNudges). */
  canNudge: (recipientId: string) => boolean;
  onNudge: (recipientId: string, recipientName: string) => void;
  /** ✅ — only an admin_only viewer gets this column at all (a playing member looking at "Ver todos" never sees it, even if they're the group's admin). */
  canValidate: boolean;
  onValidate: (memberId: string, memberName: string) => void;
}) {
  // Me first (so I don't have to hunt for my own row), then everyone else
  // alphabetically — the emerald name color below is the only thing that
  // still marks which row is mine once it's not pinned to the top by state.
  const sortedMembers = [...members].sort((a, b) => {
    if (a.user_id === currentUserId) return -1;
    if (b.user_id === currentUserId) return 1;
    return a.full_name.localeCompare(b.full_name);
  });

  return (
    <>
      <View style={styles.teamHeaderRow}>
        <View style={styles.teamNameCol} />
        {DAY_LABELS.map((label, index) => (
          <Text key={label + index} style={[styles.dayLabel, styles.teamDayLabel, days[index] === todayString && styles.dayLabelToday]}>
            {label}
          </Text>
        ))}
        {canValidate ? <Text style={[styles.dayLabel, styles.nudgeHeaderLabel]}>✅</Text> : null}
        <Text style={[styles.dayLabel, styles.nudgeHeaderLabel]}>Bud</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.teamLoading} />
      ) : sortedMembers.length === 0 ? (
        <Text style={styles.hint}>Todavía no hay miembros entrenando en este grupo.</Text>
      ) : (
        sortedMembers.map((member) => (
          <View key={member.user_id} style={styles.teamMemberRow}>
            <Text
              style={[styles.teamNameCol, member.user_id === currentUserId && styles.teamNameMe]}
              numberOfLines={1}
            >
              {member.full_name}
            </Text>
            {days.map((day) => {
              const status = member.dailyStatus[day];
              const tone: 'neutral' | 'success' | 'warning' | 'danger' =
                status === 'completed' ? 'success' : status === 'excused' ? 'warning' : status === 'failed' ? 'danger' : 'neutral';
              const checkinForDay = checkinsByDate.get(day)?.find((c) => c.user_id === member.user_id);
              return (
                <Pressable key={day} disabled={!checkinForDay} onPress={() => checkinForDay && onPressPhoto(checkinForDay.photo_path)}>
                  <View style={[styles.dayDot, styles.teamDot, dayToneStyle(tone)]}>
                    <Text
                      style={[
                        styles.dayDotText,
                        tone === 'success' && styles.dayDotTextSuccess,
                        tone === 'danger' && styles.dayDotTextDanger,
                        tone === 'warning' && styles.dayDotTextWarning,
                      ]}
                    >
                      {tone === 'danger' ? '✗' : tone === 'success' ? '✓' : tone === 'warning' ? '–' : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {canValidate ? (
              (() => {
                // ✅ — same eligibility shape as "Bud" below: only today,
                // never for my own row (admin_only never plays), and only
                // while the member hasn't already decided today (no
                // check-in, no override, not excused) — once validated,
                // dailyStatus[todayString] flips to 'completed' and this
                // slot goes back to a blank spacer.
                const eligible =
                  isCurrentWeek && member.user_id !== currentUserId && !member.dailyStatus[todayString];
                if (!eligible) {
                  return <View style={styles.nudgeSlot} />;
                }
                return (
                  <Pressable
                    key="validate"
                    onPress={() => onValidate(member.user_id, member.full_name)}
                    hitSlop={4}
                    style={styles.nudgeSlot}
                  >
                    <Text style={styles.nudgeButtonText}>✅</Text>
                  </Pressable>
                );
              })()
            ) : null}
            {(() => {
              // "Bud" — only while viewing the current week (nudging someone
              // about a day that's already over is meaningless — this whole
              // card's dots can be for last week while todayString/dailyStatus
              // underneath always refer to the real today, so this has to be
              // checked explicitly, not inferred from which days are on
              // screen), for a teammate who hasn't decided today yet (no
              // check-in, not excused), isn't me, and isn't under the 2/day
              // cap or 12h cooldown since my last nudge to them (canNudge).
              // The button just disappears rather than showing a disabled/
              // "done" state — a bare spacer keeps every row's dots aligned
              // either way.
              const eligible =
                isCurrentWeek && member.user_id !== currentUserId && !member.dailyStatus[todayString] && canNudge(member.user_id);
              if (!eligible) {
                return <View style={styles.nudgeSlot} />;
              }
              return (
                <Pressable key="nudge" onPress={() => onNudge(member.user_id, member.full_name)} hitSlop={4} style={styles.nudgeSlot}>
                  <Text style={styles.nudgeButtonText}>👋🏼</Text>
                </Pressable>
              );
            })()}
          </View>
        ))
      )}
    </>
  );
}

function dayToneStyle(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  const map = {
    neutral: { backgroundColor: colors.surfaceAlt },
    success: { backgroundColor: '#123424' },
    // A dark, low-lightness amber reads as brown no matter how it's tuned —
    // that's just how human color perception categorizes dark orange/amber
    // (brown IS dark orange, not a separate hue). Lighter/more saturated
    // than success/danger's dark chips on purpose, so the yellow actually
    // registers instead of blending into a muddy near-black blob.
    warning: { backgroundColor: '#60492A' },
    danger: { backgroundColor: '#3A1414' },
  };
  return map[tone];
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xs,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  groupName: { ...typography.title, color: colors.text },
  inviteCode: { color: colors.textMuted, marginTop: 2 },
  voteBanner: { backgroundColor: colors.primary },
  voteBannerText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
  statusCard: { gap: spacing.sm },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { color: colors.textMuted },
  balance: { ...typography.title, color: colors.text },
  hint: { color: colors.textMuted, fontSize: 13 },
  cardTitle: { ...typography.heading, color: colors.text, textAlign: 'center' },
  weekNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  weekTitleGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  weekNavButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
  },
  weekNavButtonDisabled: { opacity: 0.3 },
  weekNavButtonText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  progressLabel: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  dayColumn: { alignItems: 'center', gap: spacing.xs },
  dayDot: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDotText: { fontSize: 14 },
  dayDotTextSuccess: { color: colors.primary, fontWeight: '700' },
  dayDotTextDanger: { color: colors.danger, fontWeight: '700' },
  // Same yellow Dashboard uses for excused (colors.warning, dayStatNeutral in
  // app/(app)/dashboard/index.tsx) — the dash had no color of its own before
  // this and fell back to the default (black) text color.
  dayDotTextWarning: { color: colors.warning, fontWeight: '700' },
  dayLabel: { color: colors.textMuted, fontSize: 12 },
  dayLabelToday: { color: colors.primary, fontWeight: '700' },
  // admin_only's team week table: a name column plus one dot per weekday,
  // reusing dayDot's colors/tones but sized down (teamDot) so 7 dots + a
  // name fit one row per member without wrapping.
  teamHeaderRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  teamNameCol: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600', paddingRight: spacing.xs },
  teamNameMe: { color: colors.primary },
  teamDayLabel: { width: 26, textAlign: 'center' },
  teamMemberRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  teamDot: { width: 22, height: 22, marginHorizontal: 2 },
  teamLoading: { marginTop: spacing.md },
  // "Bud" nudge column — fixed width so every row's dots line up whether or
  // not that particular row actually shows a nudge button.
  nudgeSlot: { width: 30, height: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  // Deliberately NOT reusing nudgeSlot here — nudgeSlot's fixed height is
  // meant for centering an icon inside a Pressable's hit area, but forcing
  // that same height on a bare Text (no lineHeight to match) pushes its
  // glyph to the top of the box instead of centering it, which is exactly
  // what made "Bud" sit higher than the L M X J V S D letters next to it.
  // Same width/marginLeft for horizontal alignment, height left implicit.
  nudgeHeaderLabel: { width: 30, marginLeft: 2, textAlign: 'center', fontSize: 10 },
  nudgeButtonText: { fontSize: 16 },
  // "Ver todos" — a small centered link-style toggle rather than a full
  // Button, deliberately: this sits right under a playing member's own
  // circles, which nobody asked to see more of by default.
  seeAllButton: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  seeAllButtonText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  teamSection: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  doneCard: { gap: spacing.sm },
  doneText: { color: colors.success, fontWeight: '600', textAlign: 'center' },
  elapsedTimer: { color: colors.primary, fontSize: 28, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  stepsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  stepPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: '#123424',
  },
  stepPillPending: { backgroundColor: colors.surfaceAlt },
  stepPillText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  stepsArrow: { color: colors.textMuted },
  doneActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  workoutInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  workoutMinutes: { color: colors.text, fontWeight: '600' },
});
