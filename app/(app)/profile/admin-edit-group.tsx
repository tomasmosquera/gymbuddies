import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { TimezonePicker } from '@/components/ui/TimezonePicker';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { DEFAULT_GROUP_TIMEZONE } from '@/constants/timezones';
import { colors, spacing, typography } from '@/constants/theme';

export default function AdminEditGroupScreen() {
  const { group, refresh } = useActiveGroup();
  const [name, setName] = useState(group?.name ?? '');
  const [adminPaymentInfo, setAdminPaymentInfo] = useState(group?.admin_payment_info ?? '');
  const [timezone, setTimezone] = useState(group?.timezone ?? DEFAULT_GROUP_TIMEZONE);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
