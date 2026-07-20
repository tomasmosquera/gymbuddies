import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { ruleProposalSchema } from '@/lib/validation/schemas';
import { colors, spacing, typography } from '@/constants/theme';

const TIMING_OPTIONS: { key: 'immediate' | 'next_week'; label: string }[] = [
  { key: 'next_week', label: 'La próxima semana' },
  { key: 'immediate', label: 'De inmediato' },
];

const CHECKOUT_TOGGLE_OPTIONS: { key: 'no_change' | 'yes' | 'no'; label: string }[] = [
  { key: 'no_change', label: 'Sin cambio' },
  { key: 'yes', label: 'Sí' },
  { key: 'no', label: 'No' },
];

export default function ProposeRuleChangeScreen() {
  const { group } = useActiveGroup();
  const [minDaysPerWeek, setMinDaysPerWeek] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [weeklyPenaltyCap, setWeeklyPenaltyCap] = useState('');
  const [exitFeeAmount, setExitFeeAmount] = useState('');
  const [exitNoticeDays, setExitNoticeDays] = useState('');
  const [requireCheckoutPhoto, setRequireCheckoutPhoto] = useState<'no_change' | 'yes' | 'no'>('no_change');
  const [minWorkoutMinutes, setMinWorkoutMinutes] = useState('');
  const [timing, setTiming] = useState<'immediate' | 'next_week'>('next_week');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!group) return;
    const changes = {
      minDaysPerWeek: minDaysPerWeek ? Number(minDaysPerWeek) : undefined,
      penaltyAmount: penaltyAmount ? Number(penaltyAmount) : undefined,
      weeklyPenaltyCap: weeklyPenaltyCap ? Number(weeklyPenaltyCap) : undefined,
      exitFeeAmount: exitFeeAmount ? Number(exitFeeAmount) : undefined,
      exitNoticeDays: exitNoticeDays ? Number(exitNoticeDays) : undefined,
      requireCheckoutPhoto: requireCheckoutPhoto === 'no_change' ? undefined : requireCheckoutPhoto === 'yes',
      minWorkoutMinutes: minWorkoutMinutes ? Number(minWorkoutMinutes) : undefined,
    };
    const result = ruleProposalSchema.safeParse(changes);
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('propose_rule_change', {
        p_group_id: group.id,
        p_changes: {
          ...(result.data.minDaysPerWeek !== undefined && { min_days_per_week: result.data.minDaysPerWeek }),
          ...(result.data.penaltyAmount !== undefined && { penalty_amount: result.data.penaltyAmount }),
          ...(result.data.weeklyPenaltyCap !== undefined && { weekly_penalty_cap: result.data.weeklyPenaltyCap }),
          ...(result.data.exitFeeAmount !== undefined && { exit_fee_amount: result.data.exitFeeAmount }),
          ...(result.data.exitNoticeDays !== undefined && { exit_notice_days: result.data.exitNoticeDays }),
          ...(result.data.requireCheckoutPhoto !== undefined && {
            require_checkout_photo: result.data.requireCheckoutPhoto,
          }),
          ...(result.data.minWorkoutMinutes !== undefined && { min_workout_minutes: result.data.minWorkoutMinutes }),
        },
        p_apply_immediately: timing === 'immediate',
      });
      if (rpcError) throw new Error(rpcError.message);
      Alert.alert(
        'Propuesta enviada',
        timing === 'immediate'
          ? 'El grupo tiene 72 horas para votar. Si se aprueba, el cambio aplica de inmediato.'
          : 'El grupo tiene 72 horas para votar. Si se aprueba, el cambio aplica la próxima semana.'
      );
      router.replace('/rules');
    } catch (err) {
      Alert.alert('No se pudo enviar la propuesta', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>
          Deja en blanco lo que no quieras cambiar. La propuesta necesita mayoría de votos a favor para aplicarse.
        </Text>

        <View style={styles.form}>
          <TextField
            label="Nuevos días mínimos por semana"
            value={minDaysPerWeek}
            onChangeText={setMinDaysPerWeek}
            keyboardType="numeric"
            placeholder={group ? String(group.min_days_per_week) : ''}
          />
          <TextField
            label="Nueva penalización por día fallado (COP)"
            value={penaltyAmount}
            onChangeText={setPenaltyAmount}
            keyboardType="numeric"
            placeholder={group ? group.penalty_amount.toLocaleString('es-CO') : ''}
          />
          <TextField
            label="Nuevo tope de multa por semana (COP)"
            value={weeklyPenaltyCap}
            onChangeText={setWeeklyPenaltyCap}
            keyboardType="numeric"
            placeholder={group ? group.weekly_penalty_cap.toLocaleString('es-CO') : ''}
          />
          <TextField
            label="Nueva cuota por salir sin aviso (COP)"
            value={exitFeeAmount}
            onChangeText={setExitFeeAmount}
            keyboardType="numeric"
            placeholder={group ? group.exit_fee_amount.toLocaleString('es-CO') : ''}
          />
          <TextField
            label="Nuevos días de aviso para salir sin costo"
            value={exitNoticeDays}
            onChangeText={setExitNoticeDays}
            keyboardType="numeric"
            placeholder={group ? String(group.exit_notice_days) : ''}
          />
          <View style={styles.timingField}>
            <Text style={styles.timingLabel}>¿Exigir foto de salida al terminar el entreno?</Text>
            <SegmentedControl
              options={CHECKOUT_TOGGLE_OPTIONS}
              value={requireCheckoutPhoto}
              onChange={setRequireCheckoutPhoto}
            />
          </View>
          <TextField
            label="Nueva duración mínima del entreno (minutos)"
            value={minWorkoutMinutes}
            onChangeText={setMinWorkoutMinutes}
            keyboardType="numeric"
            placeholder={group ? String(group.min_workout_minutes) : ''}
          />
          <View style={styles.timingField}>
            <Text style={styles.timingLabel}>¿Cuándo debe aplicar el cambio si se aprueba?</Text>
            <SegmentedControl options={TIMING_OPTIONS} value={timing} onChange={setTiming} />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Enviar propuesta" onPress={handleSubmit} loading={isSubmitting} />
          <Button label="Cancelar" variant="secondary" onPress={() => router.replace('/rules')} disabled={isSubmitting} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg },
  subtitle: { ...typography.body, color: colors.textMuted },
  form: { gap: spacing.md },
  timingField: { gap: spacing.xs },
  timingLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  error: { color: colors.danger },
});
