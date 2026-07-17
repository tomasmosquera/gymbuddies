import { useMemo } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useCheckins } from '@/hooks/useCheckins';
import { useVacationDays } from '@/hooks/useVacationDays';
import { getWeekBounds, toBogotaDateString, weekDates } from '@/lib/domain/dateUtils';
import { failsRemaining } from '@/lib/domain/walletState';
import { colors, radii, spacing, typography } from '@/constants/theme';

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export default function HomeScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading, refresh: refreshGroup } = useActiveGroup();
  const { weekCheckins, todayCheckin, isLoading: checkinsLoading, refresh: refreshCheckins } = useCheckins(
    group?.id ?? null,
    session?.user.id ?? null
  );
  const { weekVacationDays, isLoading: vacationLoading, requestVacationDay } = useVacationDays(
    group?.id ?? null,
    session?.user.id ?? null
  );

  const todayString = toBogotaDateString(new Date());
  const { weekStart } = getWeekBounds(new Date());
  const days = useMemo(() => weekDates(weekStart), [weekStart]);

  const completedCount = weekCheckins.length;
  const vacationCount = weekVacationDays.length;

  if (groupLoading || checkinsLoading || vacationLoading || !group || !membership) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const effectiveRequired = Math.max(group.min_days_per_week - vacationCount, 0);
  const progress = effectiveRequired > 0 ? Math.min(completedCount / effectiveRequired, 1) : 1;
  const remainingFails = failsRemaining(membership.balance, group.penalty_amount);

  const handleVacation = () => {
    Alert.alert('Día de vacaciones', '¿Marcar el día de hoy como vacaciones?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: async () => {
          try {
            await requestVacationDay(todayString);
          } catch (err) {
            Alert.alert('No se pudo marcar', err instanceof Error ? err.message : 'Intenta de nuevo');
          }
        },
      },
    ]);
  };

  const handleRefresh = () => {
    refreshGroup();
    refreshCheckins();
  };

  return (
    <ScrollView contentContainerStyle={styles.container} onScrollEndDrag={handleRefresh}>
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
          <Button label="Recargar saldo" variant="danger" onPress={() => router.push('/wallet/recharge')} />
        ) : null}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Esta semana</Text>
        <ProgressBar progress={progress} />
        <Text style={styles.progressLabel}>
          {completedCount} / {group.min_days_per_week} días
          {vacationCount > 0 ? ` (${vacationCount} de vacaciones)` : ''}
        </Text>
        <View style={styles.weekRow}>
          {days.map((day, index) => {
            const isDone = weekCheckins.some((c) => c.checkin_date === day);
            const isVacation = weekVacationDays.some((v) => v.vacation_date === day);
            const isToday = day === todayString;
            const isPast = day < todayString;
            let tone: 'neutral' | 'success' | 'warning' | 'danger' = 'neutral';
            if (isVacation) tone = 'warning';
            else if (isDone) tone = 'success';
            else if (isPast) tone = 'danger';
            return (
              <View key={day} style={styles.dayColumn}>
                <View style={[styles.dayDot, dayToneStyle(tone)]}>
                  <Text style={styles.dayDotText}>{isVacation ? '🌴' : isDone ? '✓' : ''}</Text>
                </View>
                <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{DAY_LABELS[index]}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      {!todayCheckin ? (
        <Button label="Hacer check-in de hoy 📸" onPress={() => router.push('/checkin')} />
      ) : (
        <Card>
          <Text style={styles.doneText}>Ya hiciste check-in hoy ✓</Text>
        </Card>
      )}

      <Button label="Tomar día de vacaciones hoy" variant="secondary" onPress={handleVacation} />
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
  cardTitle: { ...typography.heading, color: colors.text, marginBottom: spacing.sm },
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
  doneText: { color: colors.success, fontWeight: '600', textAlign: 'center' },
});
