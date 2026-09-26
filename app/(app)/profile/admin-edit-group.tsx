import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { TextField } from '@/components/ui/TextField';
import { TimezonePicker } from '@/components/ui/TimezonePicker';
import { InlineDatePicker } from '@/components/ui/InlineDatePicker';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useLeagueCycle } from '@/hooks/useLeagueCycle';
import { supabase } from '@/lib/supabase/client';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import {
  canCancelEarlyClose,
  canCloseEarly,
  cycleBoundaryDate,
  dateOnlyToLocalDate,
  earlyCloseSunday,
  formatDateOnly,
} from '@/lib/domain/leagueCycle';
import { DEFAULT_GROUP_TIMEZONE } from '@/constants/timezones';
import { colors, spacing } from '@/constants/theme';

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
  const { cycle, setCycleStart, closeEarly, cancelEarlyClose } = useLeagueCycle(group?.id ?? null);
  const [name, setName] = useState(group?.name ?? '');
  const [adminPaymentInfo, setAdminPaymentInfo] = useState(group?.admin_payment_info ?? '');
  const [timezone, setTimezone] = useState(group?.timezone ?? DEFAULT_GROUP_TIMEZONE);
  const [isPublic, setIsPublic] = useState(group?.is_public ?? false);
  const [isTogglingPublic, setIsTogglingPublic] = useState(false);
  const [leagueCycleStartDate, setLeagueCycleStartDate] = useState(new Date());
  const [isSavingCycleStart, setIsSavingCycleStart] = useState(false);
  const [isChangingEarlyClose, setIsChangingEarlyClose] = useState(false);
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
    if (cycle) setLeagueCycleStartDate(dateOnlyToLocalDate(cycle.effective_start_date));
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

  const runEarlyCloseChange = async (action: () => Promise<void>) => {
    setIsChangingEarlyClose(true);
    try {
      await action();
    } catch (err) {
      Alert.alert('No se pudo cambiar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsChangingEarlyClose(false);
    }
  };

  const handleCloseEarly = () => {
    if (!group) return;
    const sunday = formatDateOnly(earlyCloseSunday(new Date(), group.timezone));
    Alert.alert(
      'Cerrar la Liga antes de tiempo',
      `El ciclo terminará este domingo ${sunday}: ese es el último día que cuenta y el lunes se reparte el premio con las posiciones finales. Se aplica de inmediato, sin votación, y se avisa a todos los integrantes. Puedes cancelarlo hasta que termine la semana. ¿Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar la Liga', style: 'destructive', onPress: () => runEarlyCloseChange(closeEarly) },
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
        <SectionHeader icon="information-circle-outline" title="Información básica" />
        <Card style={styles.card}>
          <TextField label="Nombre del grupo" value={name} onChangeText={setName} />
          <TextField
            label="Datos de pago (Nequi, Bancolombia, etc.)"
            value={adminPaymentInfo}
            onChangeText={setAdminPaymentInfo}
            placeholder="Ej: Nequi 300 123 4567"
          />
        </Card>

        <SectionHeader icon="time-outline" title="Zona horaria" />
        <Card style={styles.card}>
          <Text style={styles.hint}>
            Se aplica de inmediato, sin votación — define qué día/semana cuentan los check-ins nuevos y qué festivos
            aplican.
          </Text>
          <TimezonePicker value={timezone} onChange={setTimezone} />
        </Card>

        {canManagePublic ? (
          <>
            <SectionHeader icon="globe-outline" title="Visibilidad" />
            <Card style={styles.card}>
              <Text style={styles.hint}>
                Se aplica de inmediato — visible y unible desde &ldquo;Mis grupos → Unirme a un grupo público&rdquo;,
                sin código de invitación.
              </Text>
              <SegmentedControl options={YES_NO_OPTIONS} value={isPublic ? 'yes' : 'no'} onChange={handleTogglePublic} />
              {isTogglingPublic ? <ActivityIndicator color={colors.primary} /> : null}
            </Card>
          </>
        ) : null}

        {group && group.payout_mode !== 'cooperative' && cycle ? (
          <>
            <SectionHeader icon="trophy-outline" title="Ciclo de Liga" />
            <Card style={styles.card}>
              <Text style={styles.hint}>
                Se aplica de inmediato, sin votación — mueve también la fecha en que se reparte el premio. Un ciclo
                siempre arranca el lunes de la semana elegida (los días anteriores a la fecha que elijas cuentan como
                excusados para todos) y cierra un domingo.
              </Text>
              <InlineDatePicker value={leagueCycleStartDate} onChange={setLeagueCycleStartDate} wide />
              <Button
                label="Guardar fecha de inicio"
                variant="secondary"
                onPress={handleSaveCycleStart}
                loading={isSavingCycleStart}
              />
            </Card>

            <SectionHeader icon="flag-outline" title="Cierre anticipado" />
            <Card style={styles.card}>
              {cycle.closed_early ? (
                <>
                  <Text style={styles.hint}>
                    El ciclo cierra este domingo {formatDateOnly(cycleBoundaryDate(cycle.ends_at, group.timezone))}. El
                    lunes se conocen las posiciones finales y se reparte el premio
                    {group.league_auto_renew ? ', y arranca un ciclo nuevo' : ''}.
                  </Text>
                  {canCancelEarlyClose(cycle, new Date()) ? (
                    <Button
                      label="Cancelar cierre anticipado"
                      variant="secondary"
                      onPress={() => runEarlyCloseChange(cancelEarlyClose)}
                      loading={isChangingEarlyClose}
                    />
                  ) : null}
                </>
              ) : canCloseEarly(cycle, new Date(), group.timezone) ? (
                <>
                  <Text style={styles.hint}>
                    Termina el ciclo al cerrar esta semana: el domingo{' '}
                    {formatDateOnly(earlyCloseSunday(new Date(), group.timezone))} es el último día y el lunes se dan
                    las posiciones finales y se reparte el premio.{' '}
                    {group.league_auto_renew
                      ? 'Como la renovación automática está activada, ese mismo lunes arranca un ciclo nuevo.'
                      : 'Después la Liga queda en pausa hasta que inicies un ciclo nuevo.'}
                  </Text>
                  <Button
                    label="Iniciar cierre anticipado de la Liga"
                    variant="danger"
                    onPress={handleCloseEarly}
                    loading={isChangingEarlyClose}
                  />
                </>
              ) : (
                <Text style={styles.hint}>
                  No hay nada que adelantar: el ciclo ya termina esta semana o todavía no empieza.
                </Text>
              )}
            </Card>
          </>
        ) : null}

        <Button label="Guardar cambios" onPress={handleSubmit} loading={isSubmitting} />
        <Button label="Cancelar" variant="secondary" onPress={() => router.replace('/profile/admin')} disabled={isSubmitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.md },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
});
