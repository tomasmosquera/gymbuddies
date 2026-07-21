import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
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
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { getWeekBounds, toBogotaDateString, weekDates } from '@/lib/domain/dateUtils';
import { failsRemaining } from '@/lib/domain/walletState';
import { colors, radii, spacing, typography } from '@/constants/theme';

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export default function HomeScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading, refresh: refreshGroup } = useActiveGroup();
  const [weekOffset, setWeekOffset] = useState(0);
  const isCurrentWeek = weekOffset === 0;
  const viewedDate = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const { weekCheckins, todayCheckin, isLoading: checkinsLoading, refresh: refreshCheckins } = useCheckins(
    group?.id ?? null,
    session?.user.id ?? null,
    viewedDate
  );
  const { weekExcusedDays, isLoading: excusedLoading } = useExcusedDays(
    group?.id ?? null,
    session?.user.id ?? null,
    viewedDate
  );
  const { weekOverrides, isLoading: overridesLoading, refresh: refreshOverrides } = useAttendanceOverrides(
    group?.id ?? null,
    session?.user.id ?? null,
    viewedDate
  );
  const { rowsByPeriod, isLoading: leaderboardLoading, refresh: refreshLeaderboard } = useLeaderboard(group?.id ?? null);
  const [viewingPhotoPath, setViewingPhotoPath] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const todayString = toBogotaDateString(new Date());
  const { weekStart, weekEnd } = getWeekBounds(viewedDate);
  const days = useMemo(() => weekDates(weekStart), [weekStart]);

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
  const activatedDateString = membership ? toBogotaDateString(new Date(membership.activated_at ?? membership.joined_at)) : null;
  // Only the essentials gate the whole screen — week navigation and
  // pull-to-refresh should update their own cards in place, never blank out
  // everything else while a background fetch is in flight.
  const isWeekDataLoading = checkinsLoading || excusedLoading || overridesLoading;

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
      await Promise.all([refreshGroup(), refreshCheckins(), refreshOverrides(), refreshLeaderboard()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
    >
      <View>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.inviteCode}>Código: {group.invite_code}</Text>
      </View>

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
            let tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral';
            if (isFailedOverride) tone = 'danger';
            else if (isExcused) tone = 'warning';
            else if (isDone) tone = 'success';
            else if (isPast && !isBeforeMembership) tone = 'danger';
            return (
              <Pressable
                key={day}
                style={styles.dayColumn}
                disabled={!checkinForDay}
                onPress={() => checkinForDay && setViewingPhotoPath(checkinForDay.photo_path)}
              >
                <View style={[styles.dayDot, dayToneStyle(tone)]}>
                  <Text style={styles.dayDotText}>
                    {isFailedOverride ? '✗' : isExcused ? '🌴' : isDone ? '✓' : ''}
                  </Text>
                </View>
                <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{DAY_LABELS[index]}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {isCurrentWeek && !todayCheckin ? (
        <Button
          label={group.require_checkout_photo ? 'Foto de llegada al gym 📸' : 'Hacer check-in de hoy 📸'}
          onPress={() => router.push('/checkin')}
        />
      ) : isCurrentWeek && todayCheckin && group.require_checkout_photo && !todayCheckin.checkout_captured_at ? (
        <Card style={styles.doneCard}>
          <View style={styles.stepsRow}>
            <View style={styles.stepPill}>
              <Text style={styles.stepPillText}>1. Llegada ✓</Text>
            </View>
            <Text style={styles.stepsArrow}>→</Text>
            <View style={[styles.stepPill, styles.stepPillPending]}>
              <Text style={styles.stepPillText}>2. Salida</Text>
            </View>
          </View>
          <Text style={styles.hint}>Cuando termines de entrenar, toma tu foto de salida para que cuente la duración.</Text>
          <Button label="Tomar foto de salida 🏁" onPress={() => router.push('/checkin')} />
        </Card>
      ) : isCurrentWeek && todayCheckin ? (
        <Card style={styles.doneCard}>
          {group.require_checkout_photo && todayCheckin.checkout_captured_at ? (
            <View style={styles.stepsRow}>
              <View style={styles.stepPill}>
                <Text style={styles.stepPillText}>1. Llegada ✓</Text>
              </View>
              <Text style={styles.stepsArrow}>→</Text>
              <View style={styles.stepPill}>
                <Text style={styles.stepPillText}>2. Salida ✓</Text>
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
        currentUserId={session?.user.id ?? null}
        currency={group.currency}
        isRefreshing={leaderboardLoading}
      />

      <Button label="Solicitar excusa (viaje, médica u otra)" variant="secondary" onPress={() => router.push('/rules/excuse-request')} />
    </ScrollView>
  );
}

function dayToneStyle(tone: 'neutral' | 'success' | 'warning' | 'danger') {
  const map = {
    neutral: { backgroundColor: colors.surfaceAlt },
    success: { backgroundColor: '#123424' },
    warning: { backgroundColor: '#3A2A0E' },
    danger: { backgroundColor: '#3A1414' },
  };
  return map[tone];
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  groupName: { ...typography.title, color: colors.text },
  inviteCode: { color: colors.textMuted, marginTop: 2 },
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
  dayLabel: { color: colors.textMuted, fontSize: 12 },
  dayLabelToday: { color: colors.primary, fontWeight: '700' },
  doneCard: { gap: spacing.sm },
  doneText: { color: colors.success, fontWeight: '600', textAlign: 'center' },
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
