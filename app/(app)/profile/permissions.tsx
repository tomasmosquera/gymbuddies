import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/state/authStore';
import { registerForPushNotificationsAsync } from '@/lib/notifications/pushToken';
import { setRemindersEnabledCache } from '@/lib/notifications/reminderPreference';
import { supabase } from '@/lib/supabase/client';
import type { NotificationCategory, NotificationPreferences } from '@/lib/supabase/types';
import { colors, spacing, typography } from '@/constants/theme';

const CATEGORY_LABELS: Record<NotificationCategory, { label: string; hint: string }> = {
  group_activity: { label: 'Actividad del grupo', hint: 'Fotos y entrenos de tus compañeros, alguien se une o sale' },
  money: { label: 'Dinero y saldo', hint: 'Depósitos, recargas, ajustes de saldo, penalizaciones' },
  votes: { label: 'Votaciones', hint: 'Propuestas de reglas, excusas, retos de foto' },
  reminders: { label: 'Recordatorios', hint: 'Aviso diario de check-in y avisos de foto final pendiente' },
  admin_actions: { label: 'Administración', hint: 'Cuando el admin ajusta algo de tu cuenta directamente' },
};

const CATEGORY_ORDER: NotificationCategory[] = ['group_activity', 'money', 'votes', 'reminders', 'admin_actions'];

type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function statusBadge(status: PermissionState) {
  if (status === 'granted') return <Badge label="Permitido" tone="success" />;
  if (status === 'denied') return <Badge label="Denegado" tone="danger" />;
  if (status === 'unavailable') return <Badge label="No disponible" tone="neutral" />;
  return <Badge label="No solicitado" tone="warning" />;
}

export default function PermissionsScreen() {
  const { profile } = useAuth();
  const setProfile = useAuthStore((s) => s.setProfile);
  const [notifStatus, setNotifStatus] = useState<PermissionState>('undetermined');
  const [locationForeground, setLocationForeground] = useState<PermissionState>('undetermined');
  const [locationBackground, setLocationBackground] = useState<PermissionState>('undetermined');
  const [isRequesting, setIsRequesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const refreshPermissionStatus = useCallback(async () => {
    const notif = await Notifications.getPermissionsAsync();
    setNotifStatus(notif.granted ? 'granted' : notif.status === 'denied' ? 'denied' : 'undetermined');

    const fg = await Location.getForegroundPermissionsAsync();
    setLocationForeground(fg.granted ? 'granted' : fg.status === 'denied' ? 'denied' : 'undetermined');

    const bg = await Location.getBackgroundPermissionsAsync();
    setLocationBackground(bg.granted ? 'granted' : bg.status === 'denied' ? 'denied' : 'undetermined');
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPermissionStatus();
    }, [refreshPermissionStatus])
  );

  if (!profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const prefs = profile.notification_preferences;
  const allEnabled = CATEGORY_ORDER.every((key) => prefs[key]);

  const savePreferences = async (next: NotificationPreferences) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ notification_preferences: next })
        .eq('id', profile.id);
      if (error) throw error;
      setProfile({ ...profile, notification_preferences: next });
      await setRemindersEnabledCache(next.reminders);
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

  const handleRequestLocation = async () => {
    setIsRequesting(true);
    try {
      await Location.requestForegroundPermissionsAsync();
      await refreshPermissionStatus();
    } finally {
      setIsRequesting(false);
    }
  };

  const handleRequestBackgroundLocation = async () => {
    setIsRequesting(true);
    try {
      await Location.requestBackgroundPermissionsAsync();
      await refreshPermissionStatus();
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🔔 Notificaciones</Text>
          {statusBadge(notifStatus)}
        </View>
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
            <Button label="Configuración del sistema" variant="secondary" onPress={() => Linking.openSettings()} />
          </>
        )}
      </Card>

      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>📍 Ubicación</Text>
        </View>
        <View style={styles.locationRow}>
          <Text style={styles.categoryLabel}>Mientras se usa la app</Text>
          {statusBadge(locationForeground)}
        </View>
        <Text style={styles.hint}>Necesaria para el check-in y checkout — confirma que estás en el gimnasio.</Text>

        <View style={styles.locationRow}>
          <Text style={styles.categoryLabel}>Siempre (en segundo plano)</Text>
          {statusBadge(locationBackground)}
        </View>
        <Text style={styles.hint}>
          Opcional — permite avisarte si te alejas del gimnasio sin registrar tu foto final, incluso con la app cerrada.
        </Text>

        {locationForeground !== 'granted' ? (
          <Button
            label={locationForeground === 'denied' ? 'Abrir configuración del sistema' : 'Activar ubicación'}
            variant="secondary"
            onPress={locationForeground === 'denied' ? () => Linking.openSettings() : handleRequestLocation}
            loading={isRequesting}
          />
        ) : locationBackground !== 'granted' ? (
          <Button
            label={locationBackground === 'denied' ? 'Abrir configuración del sistema' : 'Activar ubicación "siempre"'}
            variant="secondary"
            onPress={locationBackground === 'denied' ? () => Linking.openSettings() : handleRequestBackgroundLocation}
            loading={isRequesting}
          />
        ) : (
          <Button label="Configuración del sistema" variant="secondary" onPress={() => Linking.openSettings()} />
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
  locationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
