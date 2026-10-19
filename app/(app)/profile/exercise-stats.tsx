import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { MuscleBalanceFatigueCard } from '@/components/stats/MuscleBalanceFatigueCard';
import { useMuscleTrainingHistory } from '@/hooks/useMuscleTrainingHistory';
import { useWorkoutStatsSummary } from '@/hooks/useWorkoutStatsSummary';
import type { WorkoutHistorySession } from '@/hooks/useWorkoutHistory';
import { colors, spacing, typography } from '@/constants/theme';

const RECENT_WORKOUTS_SHOWN = 6;

function formatShortDate(dateString: string): string {
  const [, month, day] = dateString.split('-');
  return `${day}/${month}`;
}

/** "45 min" / "1h 12min" — same shape as workout-history.tsx's own formatter. null only for an
 * in_progress session, which never appears in completed-only history. */
function formatSessionDuration(startedAt: string, finishedAt: string | null): string | null {
  if (!finishedAt) return null;
  const totalMinutes = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}min`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statTileValue}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

function RecentWorkoutRow({ session }: { session: WorkoutHistorySession }) {
  const duration = formatSessionDuration(session.startedAt, session.finishedAt);
  return (
    <Pressable
      style={styles.recentRow}
      onPress={() => router.push({ pathname: '/profile/workout-detail', params: { sessionId: session.id } })}
      accessibilityRole="button"
    >
      <View style={styles.flex}>
        <Text style={styles.recentLabel} numberOfLines={1}>
          {session.label}
        </Text>
        <Text style={styles.recentMeta} numberOfLines={1}>
          {formatShortDate(session.startedAt.slice(0, 10))}
          {duration ? ` · ${duration}` : ''} · {session.totalSets} series
          {session.totalKg > 0 ? ` · ${Math.round(session.totalKg).toLocaleString('es-CO')} kg` : ''}
          {session.estimatedCalories !== null ? ` · ${session.estimatedCalories} kcal` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/**
 * "Ver más información" from Stats' compact "Rutinas y ejercicios" card — the full detail that
 * card deliberately leaves out: every recent workout, and the full Balance muscular/Fatiga card
 * (window selector, ranked list, untrained chips), not just the single rolling-7-day diagram.
 */
export default function ExerciseStatsScreen() {
  const { entries: muscleEntries, isLoading: muscleLoading } = useMuscleTrainingHistory();
  const workoutStats = useWorkoutStatsSummary();
  const recentWorkouts = workoutStats.allWorkouts.slice(0, RECENT_WORKOUTS_SHOWN);

  if (workoutStats.isLoading || muscleLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={[styles.card, styles.tileRow]}>
        <StatTile label="Entrenos" value={`${workoutStats.totalWorkouts}`} />
        <StatTile label="Este mes" value={`${workoutStats.thisMonthWorkouts}`} />
        <StatTile label="Racha semanal" value={`${workoutStats.weekStreak} 🔥`} />
      </Card>

      {recentWorkouts.length > 0 ? (
        <Card style={styles.recentCard}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>Entrenos recientes</Text>
            <Pressable onPress={() => router.push('/profile/workout-history')} accessibilityRole="button">
              <Text style={styles.recentSeeAll}>
                Ver todos{workoutStats.totalWorkouts > recentWorkouts.length ? ` (${workoutStats.totalWorkouts})` : ''}
              </Text>
            </Pressable>
          </View>
          {recentWorkouts.map((session, i) => (
            <View key={session.id}>
              {i > 0 ? <View style={styles.recentDivider} /> : null}
              <RecentWorkoutRow session={session} />
            </View>
          ))}
        </Card>
      ) : null}

      <MuscleBalanceFatigueCard entries={muscleEntries} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  flex: { flex: 1 },
  card: { gap: spacing.sm },
  tileRow: { flexDirection: 'row', justifyContent: 'space-around', flexWrap: 'wrap' },
  statTile: { alignItems: 'center', gap: 2 },
  statTileValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  statTileLabel: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  recentCard: { gap: 0, padding: 0, overflow: 'hidden' },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  recentTitle: { ...typography.heading, fontSize: 15, color: colors.text },
  recentSeeAll: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  recentLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  recentMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  recentDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md },
});
