import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { CheckinPhotoColumn } from '@/components/checkin/CheckinPhotoColumn';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupWeekCheckins, type GroupCheckinWithProfile } from '@/hooks/useGroupWeekCheckins';
import { supabase } from '@/lib/supabase/client';
import { formatBogotaDateTime } from '@/lib/domain/dateUtils';
import { colors, spacing, typography } from '@/constants/theme';

function CheckinModerationRow({
  checkin,
  minWorkoutMinutes,
  onPressPhoto,
  onDeleted,
}: {
  checkin: GroupCheckinWithProfile;
  minWorkoutMinutes: number;
  onPressPhoto: (path: string) => void;
  onDeleted: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const hasCheckout = !!checkin.checkout_photo_path;
  const isShort = hasCheckout && checkin.workout_minutes !== null && checkin.workout_minutes < minWorkoutMinutes;

  const confirmDelete = () => {
    Alert.alert(
      'Borrar check-in',
      `¿Borrar el check-in de ${checkin.profile.full_name} del ${formatBogotaDateTime(new Date(checkin.captured_at))}? Ese día deja de contar como entrenado.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: handleDelete },
      ]
    );
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const { error } = await supabase.rpc('admin_delete_checkin', { p_checkin_id: checkin.id });
      if (error) throw new Error(error.message);
      onDeleted();
    } catch (err) {
      Alert.alert('No se pudo borrar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card style={styles.row}>
      <Text style={styles.name} numberOfLines={1}>
        {checkin.profile.full_name}
      </Text>
      <View style={styles.photosRow}>
        <CheckinPhotoColumn
          label="Llegada"
          photoPath={checkin.photo_path}
          capturedAt={checkin.captured_at}
          latitude={checkin.latitude}
          longitude={checkin.longitude}
          onPress={() => onPressPhoto(checkin.photo_path)}
        />
        <CheckinPhotoColumn
          label="Salida"
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
      <Button label="Borrar check-in" variant="danger" onPress={confirmDelete} loading={isDeleting} />
    </Card>
  );
}

export default function AdminPhotosScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { checkins, isLoading, refresh } = useGroupWeekCheckins(group?.id ?? null);
  const [viewingPhotoPath, setViewingPhotoPath] = useState<string | null>(null);

  // Refetches every time this screen gains focus — otherwise a check-in
  // submitted while the admin already had this screen open earlier in the
  // stack never appears without a pull-to-refresh or a full app restart.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (groupLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const sorted = [...checkins].sort((a, b) => (a.checkin_date < b.checkin_date ? 1 : -1));

  return (
    <>
      <FlatList
        contentContainerStyle={styles.container}
        data={sorted}
        keyExtractor={(item) => item.id}
        onRefresh={refresh}
        refreshing={isLoading}
        ListHeaderComponent={
          <Text style={styles.subtitle}>
            Check-ins de todo el grupo esta semana. Borrar uno quita el crédito de ese día.
          </Text>
        }
        ListEmptyComponent={
          <EmptyState title="Sin check-ins todavía" description="Nadie del grupo ha hecho check-in esta semana." />
        }
        renderItem={({ item }) => (
          <CheckinModerationRow
            checkin={item}
            minWorkoutMinutes={group.min_workout_minutes}
            onPressPhoto={setViewingPhotoPath}
            onDeleted={refresh}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
      <CheckinPhotoModal
        visible={viewingPhotoPath !== null}
        photoPath={viewingPhotoPath}
        onClose={() => setViewingPhotoPath(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  row: { gap: spacing.sm },
  name: { color: colors.text, fontWeight: '700', fontSize: 15 },
  photosRow: { flexDirection: 'row', gap: spacing.md },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  duration: { color: colors.text, fontWeight: '600', fontSize: 13 },
});
