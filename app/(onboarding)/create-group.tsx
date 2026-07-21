import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { supabase } from '@/lib/supabase/client';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { createGroupSchema } from '@/lib/validation/schemas';
import { colors, spacing, typography } from '@/constants/theme';

const YES_NO_OPTIONS: { key: 'yes' | 'no'; label: string }[] = [
  { key: 'no', label: 'No' },
  { key: 'yes', label: 'Sí' },
];

export default function CreateGroupScreen() {
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);

  const [name, setName] = useState('');
  const [initialDepositAmount, setInitialDepositAmount] = useState('');
  const [minDaysPerWeek, setMinDaysPerWeek] = useState('3');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [weeklyPenaltyCap, setWeeklyPenaltyCap] = useState('');
  const [exitFeeAmount, setExitFeeAmount] = useState('0');
  const [exitNoticeDays, setExitNoticeDays] = useState('0');
  const [requireCheckoutPhoto, setRequireCheckoutPhoto] = useState<'yes' | 'no'>('no');
  const [minWorkoutMinutes, setMinWorkoutMinutes] = useState('0');
  const [adminPaymentInfo, setAdminPaymentInfo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const result = createGroupSchema.safeParse({
      name,
      initialDepositAmount: Number(initialDepositAmount),
      minDaysPerWeek: Number(minDaysPerWeek),
      penaltyAmount: Number(penaltyAmount),
      weeklyPenaltyCap: Number(weeklyPenaltyCap),
      exitFeeAmount: Number(exitFeeAmount),
      exitNoticeDays: Number(exitNoticeDays),
      requireCheckoutPhoto: requireCheckoutPhoto === 'yes',
      minWorkoutMinutes: Number(minWorkoutMinutes),
      adminPaymentInfo,
    });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('create_group', {
        p_name: result.data.name,
        p_initial_deposit_amount: result.data.initialDepositAmount,
        p_min_days_per_week: result.data.minDaysPerWeek,
        p_penalty_amount: result.data.penaltyAmount,
        p_weekly_penalty_cap: result.data.weeklyPenaltyCap,
        p_exit_fee_amount: result.data.exitFeeAmount,
        p_exit_notice_days: result.data.exitNoticeDays,
        p_require_checkout_photo: result.data.requireCheckoutPhoto,
        p_min_workout_minutes: result.data.minWorkoutMinutes,
        p_admin_payment_info: result.data.adminPaymentInfo || null,
      });
      if (error || !data) throw new Error(error?.message ?? 'No se pudo crear el grupo');
      setActiveGroupId(data.id);
      router.replace('/deposit');
    } catch (err) {
      Alert.alert('No se pudo crear el grupo', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>
          Define las reglas iniciales. Cualquier cambio futuro necesitará el voto de la mayoría del grupo.
        </Text>

        <View style={styles.form}>
          <TextField label="Nombre del grupo" value={name} onChangeText={setName} error={errors.name} />
          <TextField
            label="Depósito inicial (COP)"
            value={initialDepositAmount}
            onChangeText={setInitialDepositAmount}
            keyboardType="numeric"
            error={errors.initialDepositAmount}
          />
          <TextField
            label="Días mínimos de gym por semana"
            value={minDaysPerWeek}
            onChangeText={setMinDaysPerWeek}
            keyboardType="numeric"
            error={errors.minDaysPerWeek}
          />
          <TextField
            label="Penalización por día fallado (COP)"
            value={penaltyAmount}
            onChangeText={setPenaltyAmount}
            keyboardType="numeric"
            error={errors.penaltyAmount}
          />
          <TextField
            label="Tope de multa por semana (COP)"
            value={weeklyPenaltyCap}
            onChangeText={setWeeklyPenaltyCap}
            keyboardType="numeric"
            error={errors.weeklyPenaltyCap}
          />
          <TextField
            label="Cuota por salir sin aviso (COP)"
            value={exitFeeAmount}
            onChangeText={setExitFeeAmount}
            keyboardType="numeric"
            error={errors.exitFeeAmount}
          />
          <TextField
            label="Días de aviso para salir sin costo"
            value={exitNoticeDays}
            onChangeText={setExitNoticeDays}
            keyboardType="numeric"
            error={errors.exitNoticeDays}
          />
          <View style={styles.toggleField}>
            <Text style={styles.toggleLabel}>¿Exigir foto final al terminar el entreno?</Text>
            <SegmentedControl options={YES_NO_OPTIONS} value={requireCheckoutPhoto} onChange={setRequireCheckoutPhoto} />
          </View>
          <TextField
            label="Duración mínima del entreno (minutos)"
            value={minWorkoutMinutes}
            onChangeText={setMinWorkoutMinutes}
            keyboardType="numeric"
            error={errors.minWorkoutMinutes}
          />
          <TextField
            label="Datos de pago (Nequi, Bancolombia, etc.)"
            value={adminPaymentInfo}
            onChangeText={setAdminPaymentInfo}
            placeholder="Ej: Nequi 300 123 4567"
            error={errors.adminPaymentInfo}
          />
          <Button label="Crear grupo" onPress={handleSubmit} loading={isSubmitting} />
        </View>

        <Link href="/join-group" style={styles.link}>
          <Text style={styles.linkText}>Ya tengo un código de invitación</Text>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg },
  subtitle: { ...typography.body, color: colors.textMuted },
  form: { gap: spacing.md },
  toggleField: { gap: spacing.xs },
  toggleLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  link: { alignSelf: 'center', marginVertical: spacing.lg },
  linkText: { color: colors.primary, fontWeight: '600' },
});
