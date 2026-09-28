import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useWorkoutHistory, type WorkoutHistorySession } from '@/hooks/useWorkoutHistory';
import { colors, spacing, typography } from '@/constants/theme';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  );
}

/** "45 min" / "1h 12min" — finishedAt is only ever null for an in_progress session, which never appears here (this list is completed-only). */
function formatSessionDuration(startedAt: string, finishedAt: string | null): string | null {
  if (!finishedAt) return null;
  const totalMinutes = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}min`;
}

function SessionCard({ session, isDeleting, onDelete }: { session: WorkoutHistorySession; isDeleting: boolean; onDelete: () => void }) {
  const duration = formatSessionDuration(session.startedAt, session.finishedAt);
  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.flex}>
          <Text style={styles.label} numberOfLines={1}>
            {session.label}
          </Text>
          <Text style={styles.date}>
            {formatDateTime(session.startedAt)}
            {duration ? ` · ${duration}` : ''}
          </Text>
        </View>
        {isDeleting ? (
          <ActivityIndicator color={colors.danger} />
        ) : (
          <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel="Borrar este entreno">
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        )}
      </View>
      <Text style={styles.summary} numberOfLines={2}>
        {session.exerciseNames.join(', ') || 'Sin ejercicios'} · {session.totalSets} serie{session.totalSets === 1 ? '' : 's'}
      </Text>
    </Card>
  );
}

/** Configuración → Historial de entrenos: every completed session, newest first, with a delete action — the fix for "guardé una rutina sin querer y no sé cómo borrarla". */
export default function WorkoutHistoryScreen() {
  const { sessions, isLoading, refresh, deleteSession } = useWorkoutHistory();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const confirmDelete = (session: WorkoutHistorySession) => {
    Alert.alert('Borrar entreno', `¿Borrar "${session.label}" del ${formatDateTime(session.startedAt)}? Esto no se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(session.id);
          try {
            await deleteSession(session.id);
          } catch (err) {
            Alert.alert('No se pudo borrar', err instanceof Error ? err.message : 'Intenta de nuevo');
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {sessions.length === 0 ? (
        <EmptyState title="Sin entrenos todavía" description="Cuando termines una rutina o un entreno libre, va a aparecer aquí." />
      ) : (
        sessions.map((session) => (
          <SessionCard key={session.id} session={session} isDeleting={deletingId === session.id} onDelete={() => confirmDelete(session)} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.background },
  flex: { flex: 1 },
  card: { gap: spacing.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...typography.heading, fontSize: 16, color: colors.text },
  date: { color: colors.textMuted, fontSize: 12 },
  summary: { color: colors.textMuted, fontSize: 13 },
});
