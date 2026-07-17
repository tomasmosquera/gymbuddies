import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { ruleProposalSchema } from '@/lib/validation/schemas';
import { colors, spacing, typography } from '@/constants/theme';

export default function ProposeRuleChangeScreen() {
  const { group } = useActiveGroup();
  const [minDaysPerWeek, setMinDaysPerWeek] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [vacationDaysPerMonth, setVacationDaysPerMonth] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!group) return;
    const changes = {
      minDaysPerWeek: minDaysPerWeek ? Number(minDaysPerWeek) : undefined,
      penaltyAmount: penaltyAmount ? Number(penaltyAmount) : undefined,
      vacationDaysPerMonth: vacationDaysPerMonth ? Number(vacationDaysPerMonth) : undefined,
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
          ...(result.data.vacationDaysPerMonth !== undefined && {
            vacation_days_per_month: result.data.vacationDaysPerMonth,
          }),
        },
      });
      if (rpcError) throw new Error(rpcError.message);
      Alert.alert('Propuesta enviada', 'El grupo tiene 72 horas para votar.');
      router.back();
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
            placeholder={group ? String(group.penalty_amount) : ''}
          />
          <TextField
            label="Nuevos días de vacaciones al mes"
            value={vacationDaysPerMonth}
            onChangeText={setVacationDaysPerMonth}
            keyboardType="numeric"
            placeholder={group ? String(group.vacation_days_per_month) : ''}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Enviar propuesta" onPress={handleSubmit} loading={isSubmitting} />
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
  error: { color: colors.danger },
});
