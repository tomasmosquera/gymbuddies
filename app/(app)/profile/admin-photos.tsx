import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextField } from '@/components/ui/TextField';
import { CheckinPhotoColumn } from '@/components/checkin/CheckinPhotoColumn';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useGroupWeekCheckins, type GroupCheckinWithProfile } from '@/hooks/useGroupWeekCheckins';
import { supabase } from '@/lib/supabase/client';
import { adminReplacedCheckinPhotoPath, uploadImage } from '@/lib/supabase/storage';
import { formatZonedDateTime12h, toZonedDateString } from '@/lib/domain/dateUtils';
import { CHECKIN_LOCATION_MISMATCH_METERS, distanceMeters } from '@/lib/domain/geo';
import { colors, radii, spacing, typography } from '@/constants/theme';

const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "Hoy" or "Miércoles 3 de septiembre" — same day-header shape Dashboard's Día por día already uses. */
function formatDayHeader(dateString: string, todayString: string): string {
  if (dateString === todayString) return 'Hoy';
  const [year, month, day] = dateString.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  const isoIndex = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
  return `${WEEKDAY_NAMES[isoIndex]} ${day} de ${MONTH_NAMES[month - 1]}`;
}

interface DayGroup {
  date: string;
  checkins: GroupCheckinWithProfile[];
}

/** Most recent day first; within each day, earliest check-in first — a clear timeline instead of a flat, ambiguously-ordered list. */
function groupByDay(checkins: readonly GroupCheckinWithProfile[]): DayGroup[] {
  const byDate = new Map<string, GroupCheckinWithProfile[]>();
  for (const c of checkins) {
    if (!byDate.has(c.checkin_date)) byDate.set(c.checkin_date, []);
    byDate.get(c.checkin_date)!.push(c);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, list]) => ({
      date,
      checkins: [...list].sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()),
    }));
}

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
  const [isEditingCalories, setIsEditingCalories] = useState(false);
  const [caloriesInput, setCaloriesInput] = useState(
    checkin.active_energy_kcal !== null ? String(Math.round(checkin.active_energy_kcal)) : ''
  );
  const [isSavingCalories, setIsSavingCalories] = useState(false);
  const [replacingPhoto, setReplacingPhoto] = useState<'initial' | 'final' | null>(null);
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

  const handleReplacePhoto = async (which: 'initial' | 'final') => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso necesario', 'Necesitamos acceso a tus fotos para elegir la nueva.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    setReplacingPhoto(which);
    try {
      const path = adminReplacedCheckinPhotoPath(checkin.group_id, checkin.user_id, checkin.checkin_date, which);
      await uploadImage('checkins', path, result.assets[0].uri);
      const { error } = await supabase.rpc('admin_replace_checkin_photo', {
        p_checkin_id: checkin.id,
        p_which: which,
        p_photo_path: path,
      });
      if (error) throw new Error(error.message);
      onChanged();
    } catch (err) {
      Alert.alert('No se pudo cambiar la foto', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setReplacingPhoto(null);
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

  const cancelEditCalories = () => {
    setIsEditingCalories(false);
    setCaloriesInput(checkin.active_energy_kcal !== null ? String(Math.round(checkin.active_energy_kcal)) : '');
  };

  const handleSaveCalories = async () => {
    const trimmed = caloriesInput.trim();
    const numeric = trimmed ? Number(trimmed) : null;
    if (trimmed && (numeric === null || !Number.isFinite(numeric) || numeric < 0)) {
      Alert.alert('Calorías inválidas', 'Ingresa un número mayor o igual a 0, o déjalo vacío para borrarlo.');
      return;
    }
    setIsSavingCalories(true);
    try {
      const { error } = await supabase.rpc('admin_set_checkin_active_energy', {
        p_checkin_id: checkin.id,
        p_active_energy_kcal: numeric,
      });
      if (error) throw new Error(error.message);
      setIsEditingCalories(false);
      onChanged();
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingCalories(false);
    }
  };

  return (
    <Card style={styles.row}>
      <Text style={styles.name} numberOfLines={1}>
        {checkin.profile.full_name}
      </Text>
      <View style={styles.photosRow}>
        <View style={styles.photoColumnWrap}>
          <CheckinPhotoColumn
            label="Foto Inicial"
            photoPath={checkin.photo_path}
            capturedAt={checkin.captured_at}
            latitude={checkin.latitude}
            longitude={checkin.longitude}
            timezone={timezone}
            onPress={() => onPressPhoto(checkin.photo_path)}
          />
          <Pressable
            onPress={() => handleReplacePhoto('initial')}
            disabled={replacingPhoto !== null && replacingPhoto !== 'initial'}
            style={({ pressed }) => [
              styles.smallButton,
              replacingPhoto !== null && replacingPhoto !== 'initial' && styles.smallButtonDisabled,
              pressed && styles.smallButtonPressed,
            ]}
          >
            {replacingPhoto === 'initial' ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <Text style={styles.smallButtonText}>Cambiar foto</Text>
            )}
          </Pressable>
        </View>
        <View style={styles.photoColumnWrap}>
          <CheckinPhotoColumn
            label="Foto Final"
            photoPath={checkin.checkout_photo_path}
            capturedAt={checkin.checkout_captured_at}
            latitude={checkin.checkout_latitude}
            longitude={checkin.checkout_longitude}
            timezone={timezone}
            onPress={() => checkin.checkout_photo_path && onPressPhoto(checkin.checkout_photo_path)}
          />
          {hasCheckout ? (
            <Pressable
              onPress={() => handleReplacePhoto('final')}
              disabled={replacingPhoto !== null && replacingPhoto !== 'final'}
              style={({ pressed }) => [
                styles.smallButton,
                replacingPhoto !== null && replacingPhoto !== 'final' && styles.smallButtonDisabled,
                pressed && styles.smallButtonPressed,
              ]}
            >
              {replacingPhoto === 'final' ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Text style={styles.smallButtonText}>Cambiar foto</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
      {hasCheckout ? (
        <>
          {isEditingDuration ? (
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
              {isShort ? <Badge label="Corto" tone="warning" /> : null}
            </Pressable>
          )}

          {isEditingCalories ? (
            <View style={styles.durationEdit}>
              <TextField
                label="Calorías (opcional)"
                value={caloriesInput}
                onChangeText={(v) => setCaloriesInput(v.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
              />
              <View style={styles.durationEditActions}>
                <Button label="Guardar" onPress={handleSaveCalories} loading={isSavingCalories} />
                <Button label="Cancelar" variant="secondary" onPress={cancelEditCalories} disabled={isSavingCalories} />
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setIsEditingCalories(true)} style={styles.durationRow}>
              <Text style={styles.calories}>
                {checkin.active_energy_kcal !== null
                  ? `Calorías: ${Math.round(checkin.active_energy_kcal)} kcal`
                  : 'Sin calorías'}{' '}
                ✏️
              </Text>
            </Pressable>
          )}

          {isLocationMismatch ? (
            <View style={styles.durationRow}>
              <Badge label="Ubicación distinta" tone="warning" />
            </View>
          ) : null}
        </>
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

  const todayString = toZonedDateString(new Date(), group.timezone);
  const dayGroups = groupByDay(checkins);

  return (
    <>
      <FlatList
        contentContainerStyle={styles.container}
        data={dayGroups}
        keyExtractor={(group) => group.date}
        onRefresh={refresh}
        refreshing={isLoading}
        ListHeaderComponent={
          <View style={styles.header}>
            <SectionHeader icon="images-outline" title="Check-ins de esta semana" />
            <Text style={styles.subtitle}>Check-ins de todo el grupo esta semana. Borrar uno quita el crédito de ese día.</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState title="Sin check-ins todavía" description="Nadie del grupo ha hecho check-in esta semana." />
        }
        renderItem={({ item: dayGroup }) => (
          <View style={styles.dayGroup}>
            <Text style={styles.dayHeader}>{formatDayHeader(dayGroup.date, todayString)}</Text>
            <View style={styles.dayRows}>
              {dayGroup.checkins.map((checkin) => (
                <CheckinModerationRow
                  key={checkin.id}
                  checkin={checkin}
                  minWorkoutMinutes={group.min_workout_minutes}
                  timezone={group.timezone}
                  onPressPhoto={setViewingPhotoPath}
                  onChanged={refresh}
                />
              ))}
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
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
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textMuted },
  dayGroup: { gap: spacing.sm },
  dayHeader: { ...typography.heading, color: colors.text },
  dayRows: { gap: spacing.sm },
  row: { gap: spacing.sm },
  name: { color: colors.text, fontWeight: '700', fontSize: 15 },
  photosRow: { flexDirection: 'row', gap: spacing.md },
  photoColumnWrap: { flex: 1, gap: spacing.xs },
  smallButton: {
    marginTop: spacing.sm,
    alignSelf: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 30,
  },
  smallButtonPressed: { opacity: 0.85 },
  smallButtonDisabled: { opacity: 0.5 },
  smallButtonText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  duration: { color: colors.text, fontWeight: '600', fontSize: 13 },
  calories: { color: colors.warning, fontWeight: '600', fontSize: 13 },
  durationEdit: { marginTop: spacing.xs, gap: spacing.sm },
  durationEditActions: { flexDirection: 'row', gap: spacing.sm },
});
