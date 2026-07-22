import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TextField } from '@/components/ui/TextField';
import { CheckinPhotoColumn } from '@/components/checkin/CheckinPhotoColumn';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupDayAttendance, type DayAttendance, type MemberAttendance } from '@/hooks/useGroupDayAttendance';
import { usePhotoChallenges } from '@/hooks/usePhotoChallenges';
import type { GroupCheckinWithProfile } from '@/hooks/useGroupWeekCheckins';
import { getWeekBounds, toBogotaDateString } from '@/lib/domain/dateUtils';
import { colors, radii, spacing, typography } from '@/constants/theme';

type Period = 'week' | 'month' | 'all';
type ViewMode = 'days' | 'members' | 'calendar';

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'all', label: 'Acumulado' },
];

const VIEW_MODE_OPTIONS: { key: ViewMode; label: string }[] = [
  { key: 'days', label: 'Por día' },
  { key: 'members', label: 'Por miembro' },
  { key: 'calendar', label: 'Calendario' },
];

const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const WEEKDAY_SHORT_NAMES = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatDayLabel(dateString: string, todayString: string): string {
  if (dateString === todayString) return 'Hoy';
  const [year, month, day] = dateString.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const isoIndex = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
  return `${WEEKDAY_NAMES[isoIndex]} ${day} de ${MONTH_NAMES[month - 1]}`;
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Monday-start weeks covering the whole month, padded with `null` for days outside it. */
function buildCalendarWeeks(year: number, month: number): (string | null)[][] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
  const leadingBlanks = firstWeekday === 0 ? 6 : firstWeekday - 1; // Monday-start offset
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (string | null)[] = new Array(leadingBlanks).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function CalendarGrid({
  weeks,
  checkinsByDate,
  todayString,
  onPressDay,
}: {
  weeks: (string | null)[][];
  checkinsByDate: Map<string, GroupCheckinWithProfile[]>;
  todayString: string;
  onPressDay: (date: string) => void;
}) {
  return (
    <Card style={styles.calendarCard}>
      <View style={styles.calendarWeekRow}>
        {WEEKDAY_SHORT_NAMES.map((w) => (
          <Text key={w} style={styles.calendarWeekdayText}>
            {w}
          </Text>
        ))}
      </View>
      {weeks.map((week, i) => (
        <View key={i} style={styles.calendarWeekRow}>
          {week.map((date, j) => {
            if (!date) return <View key={j} style={styles.calendarCellEmpty} />;
            const dayNum = Number(date.split('-')[2]);
            const checkins = checkinsByDate.get(date) ?? [];
            const isToday = date === todayString;
            const isFuture = date > todayString;
            return (
              <Pressable
                key={j}
                style={[styles.calendarCell, isToday && styles.calendarCellToday]}
                onPress={() => onPressDay(date)}
                disabled={isFuture}
              >
                <Text style={[styles.calendarDayNumber, isToday && styles.calendarDayNumberToday]}>{dayNum}</Text>
                <View style={styles.calendarBadgeWrap}>
                  {checkins.slice(0, 4).map((c) => (
                    <View key={c.id} style={styles.calendarInitialBadge}>
                      <Text style={styles.calendarInitialText}>{getInitials(c.profile.full_name)}</Text>
                    </View>
                  ))}
                  {checkins.length > 4 ? (
                    <View style={styles.calendarInitialBadge}>
                      <Text style={styles.calendarInitialText}>+{checkins.length - 4}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

function DayCheckinRow({
  checkin,
  minWorkoutMinutes,
  isOwnCheckin,
  isChallenged,
  onPressPhoto,
  onChallenge,
}: {
  checkin: GroupCheckinWithProfile;
  minWorkoutMinutes: number;
  isOwnCheckin: boolean;
  isChallenged: boolean;
  onPressPhoto: (path: string) => void;
  onChallenge: () => void;
}) {
  const hasCheckout = !!checkin.checkout_photo_path;
  const isShort = hasCheckout && checkin.workout_minutes !== null && checkin.workout_minutes < minWorkoutMinutes;

  return (
    <View style={styles.checkinRow}>
      <View style={styles.checkinNameRow}>
        <Text style={styles.checkinName} numberOfLines={1}>
          {checkin.profile.full_name}
        </Text>
        {isChallenged ? <Badge label="En votación 🗳️" tone="warning" /> : null}
      </View>
      <View style={styles.photosRow}>
        <CheckinPhotoColumn
          label="Foto Inicial"
          photoPath={checkin.photo_path}
          capturedAt={checkin.captured_at}
          latitude={checkin.latitude}
          longitude={checkin.longitude}
          onPress={() => onPressPhoto(checkin.photo_path)}
        />
        <CheckinPhotoColumn
          label="Foto Final"
          photoPath={checkin.checkout_photo_path}
          capturedAt={checkin.checkout_captured_at}
          latitude={checkin.checkout_latitude}
          longitude={checkin.checkout_longitude}
          onPress={() => checkin.checkout_photo_path && onPressPhoto(checkin.checkout_photo_path)}
        />
      </View>
      {hasCheckout ? (
        <View style={styles.durationRow}>
          <Text style={styles.duration}>Duración: {checkin.workout_minutes} min</Text>
          {isShort ? <Badge label="Corto" tone="warning" /> : null}
        </View>
      ) : null}
      {!isOwnCheckin && !isChallenged ? (
        <Button label="Pedir votación para invalidar" variant="secondary" onPress={onChallenge} />
      ) : null}
    </View>
  );
}

function DayRow({
  day,
  todayString,
  isExpanded,
  checkins,
  minWorkoutMinutes,
  currentUserId,
  challengedCheckinIds,
  onToggle,
  onPressPhoto,
  onChallenge,
}: {
  day: DayAttendance;
  todayString: string;
  isExpanded: boolean;
  checkins: GroupCheckinWithProfile[];
  minWorkoutMinutes: number;
  currentUserId: string | null;
  challengedCheckinIds: Set<string>;
  onToggle: () => void;
  onPressPhoto: (path: string) => void;
  onChallenge: (checkin: GroupCheckinWithProfile) => void;
}) {
  return (
    <Card style={styles.dayCard}>
      <Pressable onPress={onToggle} style={styles.dayHeader}>
        <Text style={styles.dayLabel}>{formatDayLabel(day.date, todayString)}</Text>
        <View style={styles.dayStats}>
          <Text style={[styles.dayStat, styles.dayStatGood]}>{day.completedCount} ✓</Text>
          {day.excusedCount > 0 ? <Text style={[styles.dayStat, styles.dayStatNeutral]}>{day.excusedCount} 🌴</Text> : null}
          {day.notTrainedCount > 0 ? <Text style={[styles.dayStat, styles.dayStatBad]}>{day.notTrainedCount} ✗</Text> : null}
          <Text style={styles.dayStatTotal}>de {day.activeMemberCount} integrante{day.activeMemberCount === 1 ? '' : 's'}</Text>
        </View>
      </Pressable>
      {isExpanded ? (
        checkins.length > 0 ? (
          <View style={styles.checkinsList}>
            {checkins.map((c) => (
              <DayCheckinRow
                key={c.id}
                checkin={c}
                minWorkoutMinutes={minWorkoutMinutes}
                isOwnCheckin={c.user_id === currentUserId}
                isChallenged={challengedCheckinIds.has(c.id)}
                onPressPhoto={onPressPhoto}
                onChallenge={() => onChallenge(c)}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.emptyDayText}>Nadie entrenó este día.</Text>
        )
      ) : null}
    </Card>
  );
}

function MemberRow({
  member,
  isExpanded,
  days,
  checkinsByDate,
  minWorkoutMinutes,
  currentUserId,
  challengedCheckinIds,
  todayString,
  onToggle,
  onPressPhoto,
  onChallenge,
}: {
  member: MemberAttendance;
  isExpanded: boolean;
  days: DayAttendance[];
  checkinsByDate: Map<string, GroupCheckinWithProfile[]>;
  minWorkoutMinutes: number;
  currentUserId: string | null;
  challengedCheckinIds: Set<string>;
  todayString: string;
  onToggle: () => void;
  onPressPhoto: (path: string) => void;
  onChallenge: (checkin: GroupCheckinWithProfile) => void;
}) {
  const decidedDays = member.completedCount + member.failedCount;
  const compliancePercent = decidedDays > 0 ? Math.round((member.completedCount / decidedDays) * 100) : null;

  return (
    <Card style={styles.dayCard}>
      <Pressable onPress={onToggle} style={styles.dayHeader}>
        <Text style={styles.dayLabel} numberOfLines={1}>
          {member.full_name}
        </Text>
        <View style={styles.dayStats}>
          <Text style={[styles.dayStat, styles.dayStatGood]}>{member.completedCount} ✓</Text>
          {member.excusedCount > 0 ? (
            <Text style={[styles.dayStat, styles.dayStatNeutral]}>{member.excusedCount} 🌴</Text>
          ) : null}
          {member.failedCount > 0 ? <Text style={[styles.dayStat, styles.dayStatBad]}>{member.failedCount} ✗</Text> : null}
          {compliancePercent !== null ? <Text style={styles.dayStatTotal}>{compliancePercent}%</Text> : null}
        </View>
      </Pressable>
      {isExpanded ? (
        <View style={styles.checkinsList}>
          {days.map((day) => {
            const status = member.dailyStatus[day.date];
            if (!status) return null; // before this member's activation, or today (not decided yet)

            if (status === 'completed') {
              const checkin = checkinsByDate.get(day.date)?.find((c) => c.user_id === member.user_id);
              if (!checkin) return null;
              return (
                <View key={day.date}>
                  <Text style={styles.memberDayLabel}>{formatDayLabel(day.date, todayString)}</Text>
                  <DayCheckinRow
                    checkin={checkin}
                    minWorkoutMinutes={minWorkoutMinutes}
                    isOwnCheckin={member.user_id === currentUserId}
                    isChallenged={challengedCheckinIds.has(checkin.id)}
                    onPressPhoto={onPressPhoto}
                    onChallenge={() => onChallenge(checkin)}
                  />
                </View>
              );
            }

            return (
              <View key={day.date} style={styles.memberDayRow}>
                <Text style={styles.memberDayLabel}>{formatDayLabel(day.date, todayString)}</Text>
                <Badge
                  label={status === 'excused' ? 'Excusado 🌴' : 'Fallado ✗'}
                  tone={status === 'excused' ? 'neutral' : 'danger'}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

export default function DashboardScreen() {
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { challenges, createChallenge, refresh: refreshChallenges } = usePhotoChallenges(group?.id ?? null);
  const challengedCheckinIds = useMemo(() => new Set(challenges.map((c) => c.checkin_id)), [challenges]);
  const [period, setPeriod] = useState<Period>('week');
  const [viewMode, setViewMode] = useState<ViewMode>('days');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [expandedCalendarDate, setExpandedCalendarDate] = useState<string | null>(null);
  const [viewingPhotoPath, setViewingPhotoPath] = useState<string | null>(null);
  const [challengeTarget, setChallengeTarget] = useState<GroupCheckinWithProfile | null>(null);
  const [challengeReason, setChallengeReason] = useState('');
  const [isSubmittingChallenge, setIsSubmittingChallenge] = useState(false);

  const todayString = toBogotaDateString(new Date());

  const [calendarMonth, setCalendarMonth] = useState(() => {
    const [year, month] = todayString.split('-').map(Number);
    return { year, month };
  });
  const canGoToNextMonth =
    calendarMonth.year < Number(todayString.split('-')[0]) ||
    (calendarMonth.year === Number(todayString.split('-')[0]) && calendarMonth.month < Number(todayString.split('-')[1]));
  const goPrevMonth = () =>
    setCalendarMonth((c) => (c.month === 1 ? { year: c.year - 1, month: 12 } : { year: c.year, month: c.month - 1 }));
  const goNextMonth = () =>
    setCalendarMonth((c) => (c.month === 12 ? { year: c.year + 1, month: 1 } : { year: c.year, month: c.month + 1 }));
  const calendarWeeks = useMemo(
    () => buildCalendarWeeks(calendarMonth.year, calendarMonth.month),
    [calendarMonth]
  );

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (viewMode === 'calendar') {
      const mm = String(calendarMonth.month).padStart(2, '0');
      const lastDay = new Date(Date.UTC(calendarMonth.year, calendarMonth.month, 0)).getUTCDate();
      return { rangeStart: `${calendarMonth.year}-${mm}-01`, rangeEnd: `${calendarMonth.year}-${mm}-${String(lastDay).padStart(2, '0')}` };
    }
    if (period === 'week') {
      const { weekStart, weekEnd } = getWeekBounds(new Date());
      return { rangeStart: weekStart, rangeEnd: weekEnd };
    }
    if (period === 'month') {
      const [year, month] = todayString.split('-');
      return { rangeStart: `${year}-${month}-01`, rangeEnd: todayString };
    }
    const start = group?.created_at ? toBogotaDateString(new Date(group.created_at)) : todayString;
    return { rangeStart: start, rangeEnd: todayString };
  }, [viewMode, calendarMonth, period, group?.created_at, todayString]);

  const { days, members, checkinsByDate, isLoading, refresh } = useGroupDayAttendance(
    group?.id ?? null,
    rangeStart,
    rangeEnd
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshChallenges();
    }, [refresh, refreshChallenges])
  );

  const handleChallenge = (checkin: GroupCheckinWithProfile) => {
    setChallengeReason('');
    setChallengeTarget(checkin);
  };

  const handleSubmitChallenge = async () => {
    if (!challengeTarget) return;
    const reason = challengeReason.trim();
    if (!reason) {
      Alert.alert('Falta el motivo', 'Escribe por qué crees que esta foto no debería ser válida.');
      return;
    }
    setIsSubmittingChallenge(true);
    try {
      await createChallenge(challengeTarget.id, reason);
      setChallengeTarget(null);
      Alert.alert('Votación abierta', 'El grupo tiene 72 horas para votar.');
    } catch (err) {
      Alert.alert('No se pudo abrir la votación', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmittingChallenge(false);
    }
  };

  if (groupLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Days with nobody active yet (group didn't exist, or everyone joined
  // later) carry no information — hide them from "Por día" instead of
  // padding the list with empty rows.
  const visibleDays = days.filter((d) => d.activeMemberCount > 0);

  const totals = days.reduce(
    (acc, d) => ({
      completed: acc.completed + d.completedCount,
      excused: acc.excused + d.excusedCount,
      notTrained: acc.notTrained + d.notTrainedCount,
      possible: acc.possible + d.activeMemberCount,
    }),
    { completed: 0, excused: 0, notTrained: 0, possible: 0 }
  );
  const compliancePercent = totals.possible > 0 ? Math.round((totals.completed / totals.possible) * 100) : null;

  const listHeader = (
    <View style={styles.header}>
      {viewMode === 'calendar' ? (
        <View style={styles.monthNavRow}>
          <Pressable onPress={goPrevMonth} style={styles.monthNavButton}>
            <Text style={styles.monthNavButtonText}>◀</Text>
          </Pressable>
          <Text style={styles.monthNavLabel}>
            {MONTH_NAMES[calendarMonth.month - 1]} {calendarMonth.year}
          </Text>
          <Pressable onPress={goNextMonth} disabled={!canGoToNextMonth} style={styles.monthNavButton}>
            <Text style={[styles.monthNavButtonText, !canGoToNextMonth && styles.monthNavButtonTextDisabled]}>▶</Text>
          </Pressable>
        </View>
      ) : (
        <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
      )}
      <Card style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Cómo le ha ido al grupo</Text>
        {compliancePercent === null ? (
          <Text style={styles.summaryHint}>Todavía no hay datos en este período.</Text>
        ) : (
          <>
            <Text style={styles.compliance}>{compliancePercent}%</Text>
            <Text style={styles.summaryHint}>
              {totals.completed} entrenados · {totals.excused} excusados · {totals.notTrained} fallados (de{' '}
              {totals.possible} día-miembro posibles)
            </Text>
          </>
        )}
      </Card>
      <SegmentedControl options={VIEW_MODE_OPTIONS} value={viewMode} onChange={setViewMode} />
      {viewMode !== 'calendar' ? (
        <Text style={styles.sectionTitle}>
          {viewMode === 'days' ? 'Por día — toca uno para ver las fotos' : 'Por miembro'}
        </Text>
      ) : (
        <Text style={styles.sectionTitle}>Toca un día para ver quién entrenó</Text>
      )}
    </View>
  );

  return (
    <>
      {viewMode === 'days' ? (
        <FlatList
          contentContainerStyle={styles.container}
          data={visibleDays}
          keyExtractor={(item) => item.date}
          onRefresh={refresh}
          refreshing={isLoading}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={<EmptyState title="Sin datos" description="No hay días para mostrar en este período." />}
          renderItem={({ item }) => (
            <DayRow
              day={item}
              todayString={todayString}
              isExpanded={expandedDate === item.date}
              checkins={checkinsByDate.get(item.date) ?? []}
              minWorkoutMinutes={group.min_workout_minutes}
              currentUserId={session?.user.id ?? null}
              challengedCheckinIds={challengedCheckinIds}
              onToggle={() => setExpandedDate((d) => (d === item.date ? null : item.date))}
              onPressPhoto={setViewingPhotoPath}
              onChallenge={handleChallenge}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        />
      ) : viewMode === 'members' ? (
        <FlatList
          contentContainerStyle={styles.container}
          data={members}
          keyExtractor={(item) => item.user_id}
          onRefresh={refresh}
          refreshing={isLoading}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={<EmptyState title="Sin datos" description="No hay integrantes para mostrar." />}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              days={days}
              checkinsByDate={checkinsByDate}
              isExpanded={expandedMemberId === item.user_id}
              minWorkoutMinutes={group.min_workout_minutes}
              currentUserId={session?.user.id ?? null}
              challengedCheckinIds={challengedCheckinIds}
              todayString={todayString}
              onToggle={() => setExpandedMemberId((id) => (id === item.user_id ? null : item.user_id))}
              onPressPhoto={setViewingPhotoPath}
              onChallenge={handleChallenge}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.primary} />}
        >
          {listHeader}
          <CalendarGrid
            weeks={calendarWeeks}
            checkinsByDate={checkinsByDate}
            todayString={todayString}
            onPressDay={setExpandedCalendarDate}
          />
        </ScrollView>
      )}
      <Modal
        visible={expandedCalendarDate !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setExpandedCalendarDate(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            <View style={styles.dayHeader}>
              <Text style={styles.modalTitle}>
                {expandedCalendarDate ? formatDayLabel(expandedCalendarDate, todayString) : ''}
              </Text>
              <Pressable onPress={() => setExpandedCalendarDate(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              {expandedCalendarDate && (checkinsByDate.get(expandedCalendarDate)?.length ?? 0) > 0 ? (
                <View style={styles.checkinsList}>
                  {checkinsByDate.get(expandedCalendarDate)!.map((c) => (
                    <DayCheckinRow
                      key={c.id}
                      checkin={c}
                      minWorkoutMinutes={group.min_workout_minutes}
                      isOwnCheckin={c.user_id === session?.user.id}
                      isChallenged={challengedCheckinIds.has(c.id)}
                      onPressPhoto={setViewingPhotoPath}
                      onChallenge={() => handleChallenge(c)}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyDayText}>Nadie entrenó este día.</Text>
              )}
            </ScrollView>
          </Card>
        </View>
      </Modal>
      <CheckinPhotoModal
        visible={viewingPhotoPath !== null}
        photoPath={viewingPhotoPath}
        onClose={() => setViewingPhotoPath(null)}
      />
      <Modal visible={challengeTarget !== null} transparent animationType="fade" onRequestClose={() => setChallengeTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>Pedir votación</Text>
            <Text style={styles.modalBody}>
              ¿Por qué crees que el check-in de {challengeTarget?.profile.full_name} no debería ser válido? El grupo
              podrá leer este motivo para votar. Si la mayoría (o el admin) decide que no es válida, ese día contará
              como fallado para esa persona.
            </Text>
            <TextField
              label="Motivo (obligatorio)"
              value={challengeReason}
              onChangeText={setChallengeReason}
              multiline
              placeholder="Ej: la foto no muestra el gimnasio, la fecha no cuadra..."
            />
            <View style={styles.modalActions}>
              <Button label="Cancelar" variant="secondary" onPress={() => setChallengeTarget(null)} disabled={isSubmittingChallenge} />
              <Button label="Pedir votación" onPress={handleSubmitChallenge} loading={isSubmittingChallenge} />
            </View>
          </Card>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: { width: '100%', gap: spacing.md, maxHeight: '80%' },
  modalTitle: { ...typography.heading, color: colors.text },
  modalBody: { color: colors.textMuted, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  modalClose: { color: colors.textMuted, fontSize: 18, padding: spacing.xs },
  modalScroll: { flexGrow: 0 },
  monthNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthNavButton: { padding: spacing.sm },
  monthNavButtonText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  monthNavButtonTextDisabled: { color: colors.border },
  monthNavLabel: { ...typography.heading, fontSize: 16, color: colors.text, textTransform: 'capitalize' },
  calendarCard: { gap: spacing.xs },
  calendarWeekRow: { flexDirection: 'row' },
  calendarWeekdayText: {
    flex: 1,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    paddingBottom: spacing.xs,
  },
  calendarCellEmpty: { flex: 1, minHeight: 56 },
  calendarCell: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    gap: 2,
    borderRadius: radii.sm,
  },
  calendarCellToday: { backgroundColor: colors.surfaceAlt },
  calendarDayNumber: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  calendarDayNumberToday: { color: colors.primary },
  calendarBadgeWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 2, maxWidth: 48 },
  calendarInitialBadge: {
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarInitialText: { color: colors.primaryText, fontSize: 8, fontWeight: '700' },
  header: { gap: spacing.md, marginBottom: spacing.md },
  summaryCard: { gap: spacing.xs },
  summaryTitle: { ...typography.heading, fontSize: 15, color: colors.text },
  compliance: { ...typography.title, color: colors.primary },
  summaryHint: { color: colors.textMuted, fontSize: 13 },
  sectionTitle: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  dayCard: { gap: spacing.sm },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayLabel: { color: colors.text, fontWeight: '700', fontSize: 15 },
  dayStats: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayStat: { fontWeight: '700', fontSize: 13 },
  dayStatGood: { color: colors.success },
  dayStatNeutral: { color: colors.warning },
  dayStatBad: { color: colors.danger },
  dayStatTotal: { color: colors.textMuted, fontSize: 13 },
  checkinsList: { gap: spacing.md, marginTop: spacing.xs },
  memberDayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  memberDayLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  emptyDayText: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  checkinRow: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  checkinNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkinName: { color: colors.text, fontWeight: '700', fontSize: 14 },
  photosRow: { flexDirection: 'row', gap: spacing.md },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  duration: { color: colors.text, fontWeight: '600', fontSize: 13 },
});
