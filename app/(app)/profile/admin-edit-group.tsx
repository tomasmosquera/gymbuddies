import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { TimezonePicker } from '@/components/ui/TimezonePicker';
import { InlineDatePicker } from '@/components/ui/InlineDatePicker';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useLeagueCycle } from '@/hooks/useLeagueCycle';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { DEFAULT_GROUP_TIMEZONE } from '@/constants/timezones';
import { colors, spacing, typography } from '@/constants/theme';

const YES_NO_OPTIONS: { key: 'yes' | 'no'; label: string }[] = [
  { key: 'no', label: 'No' },
  { key: 'yes', label: 'Sí' },
];

// UI-only gate, same as create-group.tsx — the real authority is server-side
// (admin_set_group_public checks profiles.is_platform_admin).
const PLATFORM_ADMIN_EMAIL = 'tomasmosquera@hotmail.com';

export default function AdminEditGroupScreen() {
  const { session } = useAuth();
  const { group, refresh } = useActiveGroup();
  const { cycle, setCycleStart } = useLeagueCycle(group?.id ?? null);
  const [name, setName] = useState(group?.name ?? '');
  const [adminPaymentInfo, setAdminPaymentInfo] = useState(group?.admin_payment_info ?? '');
  const [timezone, setTimezone] = useState(group?.timezone ?? DEFAULT_GROUP_TIMEZONE);
  const [isPublic, setIsPublic] = useState(group?.is_public ?? false);
  const [isTogglingPublic, setIsTogglingPublic] = useState(false);
  const [leagueCycleStartDate, setLeagueCycleStartDate] = useState(new Date());
  const [isSavingCycleStart, setIsSavingCycleStart] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canManagePublic = session?.user.email === PLATFORM_ADMIN_EMAIL;

  const applyPublicToggle = async (nextValue: boolean) => {
    if (!group) return;
    setIsTogglingPublic(true);
    try {
      const { error } = await supabase.rpc('admin_set_group_public', {
        p_group_id: group.id,
        p_is_public: nextValue,
      });
      if (error) throw new Error(error.message);
      setIsPublic(nextValue);
      await refresh();
    } catch (err) {
      Alert.alert('No se pudo cambiar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsTogglingPublic(false);
    }
  };

  const handleTogglePublic = (next: 'yes' | 'no') => {
    if (next === 'no') {
      applyPublicToggle(false);
      return;
    }
    Alert.alert(
      'Hacer público',
      'Cualquier persona va a poder encontrar este grupo y unirse desde "Mis grupos → Unirme a un grupo público", sin código de invitación. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Hacer público', onPress: () => applyPublicToggle(true) },
      ]
    );
  };

  useEffect(() => {
    if (cycle) setLeagueCycleStartDate(new Date(cycle.started_at));
  }, [cycle]);

  const applyCycleStart = async () => {
    if (!group) return;
    setIsSavingCycleStart(true);
    try {
      await setCycleStart(toZonedDateString(leagueCycleStartDate, group.timezone));
    } catch (err) {
      Alert.alert('No se pudo cambiar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSavingCycleStart(false);
    }
  };

  const handleSaveCycleStart = () => {
    Alert.alert(
      'Cambiar fecha de inicio del ciclo',
      'Se aplica de inmediato, sin votación — mueve también la fecha en que se reparte el premio de Liga. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cambiar', onPress: applyCycleStart },
      ]
    );
  };

  const saveChanges = async () => {
    if (!group) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('groups')
        .update({ name: name.trim(), admin_payment_info: adminPaymentInfo.trim() || null, timezone })
        .eq('id', group.id);
      if (error) throw new Error(error.message);
      await refresh();
      router.replace('/profile/admin');
    } catch (err) {
      Alert.alert('No se pudo guardar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!group) return;
    if (name.trim().length < 3) {
      Alert.alert('Nombre inválido', 'El nombre debe tener al menos 3 caracteres.');
      return;
    }
    // Changing the timezone mid-week isn't retroactive — check-ins already
    // made keep the day they were assigned under the old timezone, and the
    // week/holiday math only starts using the new one going forward. Warn
    // before applying it, since this can make the week in progress land
    // oddly (e.g. a few hours shorter/longer than 7 days).
    if (timezone !== group.timezone) {
      Alert.alert(
        'Cambiar zona horaria',
        'Esto no es retroactivo — los check-ins que ya hiciste quedan con el día que ya tienen. Cambiarla a mitad de semana puede hacer que esta semana en curso quede un poco corta o larga. ¿Continuar?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Continuar', onPress: saveChanges },
        ]
      );
      return;
    }
    await saveChanges();
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <TextField label="Nombre del grupo" value={name} onChangeText={setName} />
          <TextField
            label="Datos de pago (Nequi, Bancolombia, etc.)"
            value={adminPaymentInfo}
            onChangeText={setAdminPaymentInfo}
            placeholder="Ej: Nequi 300 123 4567"
          />
          <View style={styles.timezoneSection}>
            <Text style={styles.timezoneLabel}>Zona horaria del grupo</Text>
            <Text style={styles.timezoneHint}>
              Se aplica de inmediato, sin votación — define qué día/semana cuentan los check-ins nuevos y qué
              festivos aplican.
            </Text>
            <TimezonePicker value={timezone} onChange={setTimezone} />
          </View>
          {canManagePublic ? (
            <View style={styles.timezoneSection}>
              <Text style={styles.timezoneLabel}>Grupo público</Text>
              <Text style={styles.timezoneHint}>
                Se aplica de inmediato — visible y unible desde &ldquo;Mis grupos → Unirme a un grupo público&rdquo;, sin
                código de invitación.
              </Text>
              <SegmentedControl
                options={YES_NO_OPTIONS}
                value={isPublic ? 'yes' : 'no'}
                onChange={handleTogglePublic}
              />
              {isTogglingPublic ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
          ) : null}
          {group && group.payout_mode !== 'cooperative' && cycle ? (
            <View style={styles.timezoneSection}>
              <Text style={styles.timezoneLabel}>Fecha de inicio del ciclo de Liga</Text>
              <Text style={styles.timezoneHint}>
                Se aplica de inmediato, sin votación — mueve también la fecha en que se reparte el premio.
              </Text>
              <InlineDatePicker value={leagueCycleStartDate} onChange={setLeagueCycleStartDate} />
              <Button
                label="Guardar fecha de inicio"
                variant="secondary"
                onPress={handleSaveCycleStart}
                loading={isSavingCycleStart}
              />
            </View>
          ) : null}
          <Button label="Guardar cambios" onPress={handleSubmit} loading={isSubmitting} />
          <Button
            label="Cancelar"
            variant="secondary"
            onPress={() => router.replace('/profile/admin')}
            disabled={isSubmitting}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg },
  form: { gap: spacing.md },
  timezoneSection: { gap: spacing.xs },
  timezoneLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  timezoneHint: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginBottom: spacing.xs },
});
