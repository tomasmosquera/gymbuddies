import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { requestAppleHealthAuthorization } from '@/lib/health/appleHealth';
import { supabase } from '@/lib/supabase/client';
import { colors, spacing, typography } from '@/constants/theme';

type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

function statusBadge(status: PermissionState) {
  if (status === 'granted') return <Badge label="Permitido" tone="success" />;
  if (status === 'denied') return <Badge label="Denegado" tone="danger" />;
  if (status === 'unavailable') return <Badge label="No disponible" tone="neutral" />;
  return <Badge label="No solicitado" tone="warning" />;
}

export default function SettingsScreen() {
  const { profile, isInitializing, refreshProfile } = useAuth();
  const [locationForeground, setLocationForeground] = useState<PermissionState>('undetermined');
  const [locationBackground, setLocationBackground] = useState<PermissionState>('undetermined');
  const [isRequesting, setIsRequesting] = useState(false);
  const [isSavingHealth, setIsSavingHealth] = useState(false);
  const [isSavingAutoCheckin, setIsSavingAutoCheckin] = useState(false);

  const refreshPermissionStatus = useCallback(async () => {
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

  if (isInitializing || !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

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

  const handleToggleAppleHealth = async (value: boolean) => {
    setIsSavingHealth(true);
    try {
      if (value) {
        await requestAppleHealthAuthorization();
      }
      const { error } = await supabase.rpc('set_apple_health_enabled', { p_enabled: value });
      if (error) throw error;
      await refreshProfile();
    } finally {
      setIsSavingHealth(false);
    }
  };

  const handleToggleAutoCheckin = async (value: boolean) => {
    setIsSavingAutoCheckin(true);
    try {
      const { error } = await supabase.rpc('set_auto_checkin_other_groups', { p_enabled: value });
      if (error) throw error;
      await refreshProfile();
    } finally {
      setIsSavingAutoCheckin(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Ubicación</Text>
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

      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Check-in en tus otros grupos</Text>
        </View>
        <Text style={styles.hint}>
          Cuando haces check-in (o registras tu foto final) en un grupo, esto te pregunta si quieres replicarlo en
          tus otros grupos activos — usando la misma foto y ubicación. Si en alguno de esos grupos ya habías hecho
          tu propio check-in distinto ese día, ese no se toca.
        </Text>
        <View style={styles.masterRow}>
          <View style={styles.masterTextWrap}>
            <Text style={styles.masterLabel}>Replicar en mis otros grupos</Text>
          </View>
          <Switch
            value={profile.auto_checkin_other_groups}
            onValueChange={handleToggleAutoCheckin}
            disabled={isSavingAutoCheckin}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.text}
          />
        </View>
      </Card>

      {Platform.OS === 'ios' ? (
        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Apple Health</Text>
          </View>
          <Text style={styles.hint}>
            Si la conectas, Gym Buddies lee las calorías activas que quemaste durante tu entreno (desde tu Apple Watch
            u otro dispositivo conectado a Health) y las muestra junto a tu foto final. Es solo informativo — nunca
            afecta tus penalizaciones ni tu ranking.
          </Text>
          <View style={styles.masterRow}>
            <View style={styles.masterTextWrap}>
              <Text style={styles.masterLabel}>Conectar Apple Health</Text>
            </View>
            <Switch
              value={profile.apple_health_enabled ?? false}
              onValueChange={handleToggleAppleHealth}
              disabled={isSavingHealth}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.text}
            />
          </View>
          <Text style={styles.hint}>
            Apagar esto solo detiene la app — no revoca el permiso a nivel del sistema. Para eso, ve a Ajustes &gt;
            Salud &gt; Acceso a Datos y Dispositivos &gt; Gym Buddies.
          </Text>
          <Text style={styles.hint}>
            Si conectas pero nunca ves calorías en tus entrenos, es probable que hayas denegado el permiso en el
            aviso del sistema — iOS no le permite a la app saberlo directamente. Revisa en Ajustes &gt; Salud &gt;
            Acceso a Datos y Dispositivos &gt; Gym Buddies que &quot;Calorías activas&quot; esté permitido.
          </Text>
        </Card>
      ) : null}
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
  categoryLabel: { color: colors.text, fontWeight: '600' },
  locationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
