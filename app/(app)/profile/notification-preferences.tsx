import { useCallback, useEffect, useState } from 'react';
import { Alert, ActivityIndicator, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TextField } from '@/components/ui/TextField';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useAuth } from '@/hooks/useAuth';
import { registerForPushNotificationsAsync } from '@/lib/notifications/pushToken';
import { setRemindersEnabledCache } from '@/lib/notifications/reminderPreference';
import { stopArrivalGeofence } from '@/lib/notifications/checkinArrivalReminders';
import { supabase } from '@/lib/supabase/client';
import type { NotificationCategory, NotificationPreferences } from '@/lib/supabase/types';
import { colors, spacing, typography } from '@/constants/theme';

const CATEGORY_LABELS: Record<NotificationCategory, { label: string; hint: string }> = {
  group_activity: { label: 'Actividad del grupo', hint: 'Fotos y entrenos de tus compañeros, alguien se une o sale' },
  money: { label: 'Dinero y saldo', hint: 'Depósitos, recargas, ajustes de saldo, penalizaciones' },
  votes: { label: 'Votaciones', hint: 'Propuestas de reglas, excusas, retos de foto' },
  reminders: {
    label: 'Recordatorios',
    hint: 'Aviso diario de check-in, aviso al llegar al gimnasio, y aviso de foto final pendiente',
  },
  admin_actions: { label: 'Administración', hint: 'Cuando el admin ajusta algo de tu cuenta directamente' },
  achievements: { label: 'Logros y niveles', hint: 'Nuevos logros, retos del mes cumplidos, y subidas de nivel' },
};

const CATEGORY_ORDER: NotificationCategory[] = [
  'group_activity',
  'money',
  'votes',
  'reminders',
  'admin_actions',
  'achievements',
];

type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function statusBadge(status: PermissionState) {
  if (status === 'granted') return <Badge label="Permitido" tone="success" />;
  if (status === 'denied') return <Badge label="Denegado" tone="danger" />;
  if (status === 'unavailable') return <Badge label="No disponible" tone="neutral" />;
  return <Badge label="No solicitado" tone="warning" />;
}

export default function NotificationPreferencesScreen() {
  const { group, membership, isLoading: isLoadingGroup, refresh: refreshActiveGroup } = useActiveGroup();
  const { profile, refreshProfile } = useAuth();
  const [notifStatus, setNotifStatus] = useState<PermissionState>('undetermined');
  const [isRequesting, setIsRequesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [reminderMinutesInput, setReminderMinutesInput] = useState('20');
  const [isSavingReminderMinutes, setIsSavingReminderMinutes] = useState(false);
  const [geofenceRadiusInput, setGeofenceRadiusInput] = useState('100');
  const [isSavingGeofenceRadius, setIsSavingGeofenceRadius] = useState(false);

  useEffect(() => {
    if (profile) setReminderMinutesInput(String(profile.checkout_reminder_minutes));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when this specific field changes, not on every profile refresh (which would clobber an unsaved edit)
  }, [profile?.checkout_reminder_minutes]);

  useEffect(() => {
    if (profile) setGeofenceRadiusInput(String(profile.checkout_geofence_radius_meters));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when this specific field changes, not on every profile refresh (which would clobber an unsaved edit)
  }, [profile?.checkout_geofence_radius_meters]);

  const refreshPermissionStatus = useCallback(async () => {
    const notif = await Notifications.getPermissionsAsync();
    setNotifStatus(notif.granted ? 'granted' : notif.status === 'denied' ? 'denied' : 'undetermined');
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPermissionStatus();
    }, [refreshPermissionStatus])
  );

  if (isLoadingGroup || !membership || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const prefs = membership.notification_preferences;
  const allEnabled = CATEGORY_ORDER.every((key) => prefs[key]);

  const savePreferences = async (next: NotificationPreferences) => {
    setIsSaving(true);
    try {
      const { error } = await supabase.rpc('set_group_notification_preferences', {
        p_group_id: group.id,
        p_preferences: next,
      });
      if (error) throw error;
      await setRemindersEnabledCache(next.reminders);
      // Take effect immediately rather than waiting for the arrival-reminder
      // sync's next run (Home regaining focus) — the geofence otherwise
      // stays alive off-screen until then, however briefly.
      if (!next.reminders) await stopArrivalGeofence().catch(() => {});
      await refreshActiveGroup();
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleAll = (value: boolean) => {
    const next = CATEGORY_ORDER.reduce(
      (acc, key) => ({ ...acc, [key]: value }),
      {} as NotificationPreferences
    );
    savePreferences(next);
  };

  const handleToggleCategory = (key: NotificationCategory, value: boolean) => {
    savePreferences({ ...prefs, [key]: value });
  };

  const handleRequestNotifications = async () => {
    setIsRequesting(true);
    try {
      await registerForPushNotificationsAsync();
      await refreshPermissionStatus();
    } finally {
      setIsRequesting(false);
    }
  };

  const handleSaveReminderMinutes = async () => {
    const minutes = Number(reminderMinutesInput);
    if (!reminderMinutesInput || !Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      Alert.alert('Valor inválido', 'Ingresa un número de minutos entre 1 y 180.');
      return;
    }
    setIsSavingReminderMinutes(true);
    try {
      const { error } = await supabase.rpc('set_checkout_reminder_minutes', { p_minutes: minutes });
      if (error) throw error;
      await refreshProfile();
      Alert.alert('Guardado', 'Se actualizó el tiempo del recordatorio de foto final.');
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingReminderMinutes(false);
    }
  };

  const handleSaveGeofenceRadius = async () => {
    const meters = Number(geofenceRadiusInput);
    if (!geofenceRadiusInput || !Number.isInteger(meters) || meters < 20 || meters > 500) {
      Alert.alert('Valor inválido', 'Ingresa una distancia en metros entre 20 y 500.');
      return;
    }
    setIsSavingGeofenceRadius(true);
    try {
      const { error } = await supabase.rpc('set_checkout_geofence_radius_meters', { p_meters: meters });
      if (error) throw error;
      await refreshProfile();
      Alert.alert('Guardado', 'Se actualizó la distancia del geofence de checkout.');
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingGeofenceRadius(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Notificaciones</Text>
          {statusBadge(notifStatus)}
        </View>
        <Text style={styles.hint}>
          {`Estas categorías aplican solo a "${group.name}" — puedes tener notificaciones distintas en cada grupo al que pertenezcas.`}
        </Text>
        {notifStatus !== 'granted' ? (
          <>
            <Text style={styles.hint}>
              {notifStatus === 'denied'
                ? 'Las notificaciones están desactivadas para Gym Buddies. Actívalas desde la configuración del sistema.'
                : 'Aún no has activado las notificaciones push.'}
            </Text>
            <Button
              label={notifStatus === 'denied' ? 'Abrir configuración del sistema' : 'Activar notificaciones'}
              variant="secondary"
              onPress={notifStatus === 'denied' ? () => Linking.openSettings() : handleRequestNotifications}
              loading={isRequesting}
            />
          </>
        ) : (
          <>
            <View style={styles.masterRow}>
              <View style={styles.masterTextWrap}>
                <Text style={styles.masterLabel}>Recibir todas</Text>
              </View>
              <Switch
                value={allEnabled}
                onValueChange={handleToggleAll}
                disabled={isSaving}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.text}
              />
            </View>
            {CATEGORY_ORDER.map((key) => (
              <View key={key} style={styles.categoryRow}>
                <View style={styles.categoryTextWrap}>
                  <Text style={styles.categoryLabel}>{CATEGORY_LABELS[key].label}</Text>
                  <Text style={styles.categoryHint}>{CATEGORY_LABELS[key].hint}</Text>
                </View>
                <Switch
                  value={prefs[key]}
                  onValueChange={(value) => handleToggleCategory(key, value)}
                  disabled={isSaving}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.text}
                />
              </View>
            ))}
            {prefs.reminders ? (
              <View style={styles.reminderMinutesField}>
                <TextField
                  label="Avisar de la foto final después de (minutos)"
                  hint="Solo afecta el aviso de “no olvides tu foto de salida” — no el recordatorio diario de check-in."
                  value={reminderMinutesInput}
                  onChangeText={(v) => setReminderMinutesInput(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
                <Button
                  label="Guardar"
                  variant="secondary"
                  onPress={handleSaveReminderMinutes}
                  loading={isSavingReminderMinutes}
                />
              </View>
            ) : null}
            {prefs.reminders ? (
              <View style={styles.reminderMinutesField}>
                <TextField
                  label="Distancia para avisar que te alejaste del gimnasio (metros)"
                  hint="Qué tan lejos tienes que estar del gimnasio para que te lleguen el aviso — entre 20 y 500 metros."
                  value={geofenceRadiusInput}
                  onChangeText={(v) => setGeofenceRadiusInput(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
                <Button
                  label="Guardar"
                  variant="secondary"
                  onPress={handleSaveGeofenceRadius}
                  loading={isSavingGeofenceRadius}
                />
              </View>
            ) : null}
            <Button label="Configuración del sistema" variant="secondary" onPress={() => Linking.openSettings()} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...typography.heading, fontSize: 16, color: colors.text },
  hint: { color: colors.textMuted, fontSize: 13 },
  masterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  masterTextWrap: { flex: 1 },
  masterLabel: { color: colors.text, fontWeight: '700', fontSize: 15 },
  categoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  categoryTextWrap: { flex: 1 },
  categoryLabel: { color: colors.text, fontWeight: '600' },
  categoryHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  reminderMinutesField: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
