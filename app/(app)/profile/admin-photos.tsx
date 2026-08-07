import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextField } from '@/components/ui/TextField';
import { CheckinPhotoColumn } from '@/components/checkin/CheckinPhotoColumn';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupWeekCheckins, type GroupCheckinWithProfile } from '@/hooks/useGroupWeekCheckins';
import { supabase } from '@/lib/supabase/client';
import { formatZonedDateTime12h } from '@/lib/domain/dateUtils';
import { CHECKIN_LOCATION_MISMATCH_METERS, distanceMeters } from '@/lib/domain/geo';
import { colors, spacing, typography } from '@/constants/theme';

function CheckinModerationRow({
  checkin,
  minWorkoutMinutes,
  timezone,
  onPressPhoto,
  onChanged,
}: {
  checkin: GroupCheckinWithProfile;
  minWorkoutMinutes: number;
  timezone: string;
  onPressPhoto: (path: string) => void;
  onChanged: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingDuration, setIsEditingDuration] = useState(false);
  const [durationInput, setDurationInput] = useState(String(checkin.workout_minutes ?? 0));
  const [isSavingDuration, setIsSavingDuration] = useState(false);
  const hasCheckout = !!checkin.checkout_photo_path;
  const isShort = hasCheckout && checkin.workout_minutes !== null && checkin.workout_minutes < minWorkoutMinutes;
  const isLocationMismatch =
    hasCheckout &&
    checkin.checkout_latitude !== null &&
    checkin.checkout_longitude !== null &&
    distanceMeters(checkin.latitude, checkin.longitude, checkin.checkout_latitude, checkin.checkout_longitude) >
      CHECKIN_LOCATION_MISMATCH_METERS;

  const confirmDelete = () => {
    Alert.alert(
      'Borrar check-in',
      `¿Borrar el check-in de ${checkin.profile.full_name} del ${formatZonedDateTime12h(new Date(checkin.captured_at), timezone)}? Ese día deja de contar como entrenado.`,
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
      onChanged();
    } catch (err) {
      Alert.alert('No se pudo borrar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelEditDuration = () => {
    setIsEditingDuration(false);
    setDurationInput(String(checkin.workout_minutes ?? 0));
  };

  const handleSaveDuration = async () => {
    const numeric = Number(durationInput);
    if (!durationInput || !Number.isInteger(numeric) || numeric < 0 || numeric > 1440) {
      Alert.alert('Duración inválida', 'Ingresa un número de minutos entre 0 y 1440.');
      return;
    }
    setIsSavingDuration(true);
    try {
      const { error } = await supabase.rpc('admin_set_checkin_workout_minutes', {
        p_checkin_id: checkin.id,
        p_workout_minutes: numeric,
      });
      if (error) throw new Error(error.message);
      setIsEditingDuration(false);
      onChanged();
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingDuration(false);
    }
  };

  return (
    <Card style={styles.row}>
      <Text style={styles.name} numberOfLines={1}>
        {checkin.profile.full_name}
      </Text>
      <View style={styles.photosRow}>
        <CheckinPhotoColumn
          label="Foto Inicial"
          photoPath={checkin.photo_path}
          capturedAt={checkin.captured_at}
          latitude={checkin.latitude}
          longitude={checkin.longitude}
          timezone={timezone}
          onPress={() => onPressPhoto(checkin.photo_path)}
        />
        <CheckinPhotoColumn
          label="Foto Final"
          photoPath={checkin.checkout_photo_path}
          capturedAt={checkin.checkout_captured_at}
          latitude={checkin.checkout_latitude}
          longitude={checkin.checkout_longitude}
          timezone={timezone}
          onPress={() => checkin.checkout_photo_path && onPressPhoto(checkin.checkout_photo_path)}
        />
      </View>
      {hasCheckout ? (
        isEditingDuration ? (
          <View style={styles.durationEdit}>
            <TextField
              label="Duración (min)"
              value={durationInput}
              onChangeText={setDurationInput}
              keyboardType="numeric"
            />
            <View style={styles.durationEditActions}>
              <Button label="Guardar" onPress={handleSaveDuration} loading={isSavingDuration} />
              <Button label="Cancelar" variant="secondary" onPress={cancelEditDuration} disabled={isSavingDuration} />
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setIsEditingDuration(true)} style={styles.durationRow}>
            <Text style={styles.duration}>Duración: {checkin.workout_minutes} min ✏️</Text>
            {checkin.active_energy_kcal !== null ? (
              <Text style={styles.calories}>🔥 {Math.round(checkin.active_energy_kcal)} kcal</Text>
            ) : null}
            {isShort ? <Badge label="Corto" tone="warning" /> : null}
            {isLocationMismatch ? <Badge label="Ubicación distinta" tone="warning" /> : null}
          </Pressable>
        )
      ) : null}
      <Button label="Borrar check-in" variant="danger" onPress={confirmDelete} loading={isDeleting} />
    </Card>
  );
}

export default function AdminPhotosScreen() {
  const { group, isLoading: groupLoading } = useActiveGroup();
  const { checkins, isLoading, refresh } = useGroupWeekCheckins(group?.id ?? null, group?.timezone ?? 'America/Bogota');
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
            timezone={group.timezone}
            onPressPhoto={setViewingPhotoPath}
            onChanged={refresh}
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
  calories: { color: colors.warning, fontWeight: '600', fontSize: 13 },
  durationEdit: { marginTop: spacing.xs, gap: spacing.sm },
  durationEditActions: { flexDirection: 'row', gap: spacing.sm },
});
