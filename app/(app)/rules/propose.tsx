import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PrizeSplitEditor } from '@/components/ui/PrizeSplitEditor';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { supabase } from '@/lib/supabase/client';
import { ruleProposalSchema } from '@/lib/validation/schemas';
import { PAYOUT_MODE_DESCRIPTIONS, PAYOUT_MODE_LABELS, isFieldRelevantForMode } from '@/constants/payoutModes';
import { RULE_FIELD_HELP } from '@/constants/ruleFieldHelp';
import type { PayoutMode } from '@/lib/supabase/types';
import { colors, spacing, typography } from '@/constants/theme';

const TIMING_OPTIONS: { key: 'immediate' | 'next_week'; label: string }[] = [
  { key: 'next_week', label: 'La próxima semana' },
  { key: 'immediate', label: 'De inmediato' },
];

const APPLY_MODE_OPTIONS: { key: 'vote' | 'direct'; label: string }[] = [
  { key: 'vote', label: 'Proponer y votar' },
  { key: 'direct', label: 'Aplicar directamente' },
];

const CHECKOUT_TOGGLE_OPTIONS: { key: 'no_change' | 'yes' | 'no'; label: string }[] = [
  { key: 'no_change', label: 'Sin cambio' },
  { key: 'yes', label: 'Sí' },
  { key: 'no', label: 'No' },
];

const PAYOUT_MODE_OPTIONS: { key: 'no_change' | PayoutMode; label: string }[] = [
  { key: 'no_change', label: 'Sin cambio' },
  { key: 'cooperative', label: PAYOUT_MODE_LABELS.cooperative },
  { key: 'league', label: PAYOUT_MODE_LABELS.league },
  { key: 'mixed', label: PAYOUT_MODE_LABELS.mixed },
];

export default function ProposeRuleChangeScreen() {
  const { group, membership } = useActiveGroup();
  const isAdmin = membership?.role === 'admin';
  const [minDaysPerWeek, setMinDaysPerWeek] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [weeklyPenaltyCap, setWeeklyPenaltyCap] = useState('');
  const [exitFeeAmount, setExitFeeAmount] = useState('');
  const [exitNoticeDays, setExitNoticeDays] = useState('');
  const [requireCheckoutPhoto, setRequireCheckoutPhoto] = useState<'no_change' | 'yes' | 'no'>('no_change');
  const [minWorkoutMinutes, setMinWorkoutMinutes] = useState('');
  const [payoutMode, setPayoutMode] = useState<'no_change' | PayoutMode>('no_change');
  const [leagueDurationMonths, setLeagueDurationMonths] = useState('');
  const [leaguePrizeSplits, setLeaguePrizeSplits] = useState<string[]>([]);
  const [mixedLeagueSharePercent, setMixedLeagueSharePercent] = useState('');
  const [timing, setTiming] = useState<'immediate' | 'next_week'>('next_week');
  const [applyMode, setApplyMode] = useState<'vote' | 'direct'>('vote');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const effectiveMode: PayoutMode = payoutMode === 'no_change' ? (group?.payout_mode ?? 'cooperative') : payoutMode;

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
      payoutMode: payoutMode === 'no_change' ? undefined : payoutMode,
      leagueDurationMonths: leagueDurationMonths ? Number(leagueDurationMonths) : undefined,
      leaguePrizeSplits: leaguePrizeSplits.length > 0 ? leaguePrizeSplits.map(Number) : undefined,
      mixedLeagueSharePercent: mixedLeagueSharePercent ? Number(mixedLeagueSharePercent) : undefined,
    };
    const result = ruleProposalSchema.safeParse(changes);
    if (!result.success) {
      setError(result.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    setIsSubmitting(true);
    try {
      const p_changes = {
        ...(result.data.minDaysPerWeek !== undefined && { min_days_per_week: result.data.minDaysPerWeek }),
        ...(result.data.penaltyAmount !== undefined && { penalty_amount: result.data.penaltyAmount }),
        ...(result.data.weeklyPenaltyCap !== undefined && { weekly_penalty_cap: result.data.weeklyPenaltyCap }),
        ...(result.data.exitFeeAmount !== undefined && { exit_fee_amount: result.data.exitFeeAmount }),
        ...(result.data.exitNoticeDays !== undefined && { exit_notice_days: result.data.exitNoticeDays }),
        ...(result.data.requireCheckoutPhoto !== undefined && {
          require_checkout_photo: result.data.requireCheckoutPhoto,
        }),
        ...(result.data.minWorkoutMinutes !== undefined && { min_workout_minutes: result.data.minWorkoutMinutes }),
        ...(result.data.payoutMode !== undefined && { payout_mode: result.data.payoutMode }),
        ...(result.data.leagueDurationMonths !== undefined && {
          league_duration_months: result.data.leagueDurationMonths,
        }),
        ...(result.data.leaguePrizeSplits !== undefined && { league_prize_splits: result.data.leaguePrizeSplits }),
        ...(result.data.mixedLeagueSharePercent !== undefined && {
          mixed_league_share_percent: result.data.mixedLeagueSharePercent,
        }),
      };

      if (isAdmin && applyMode === 'direct') {
        const { error: rpcError } = await supabase.rpc('apply_rule_change_direct', {
          p_group_id: group.id,
          p_changes,
        });
        if (rpcError) throw new Error(rpcError.message);
        Alert.alert('Reglas actualizadas', 'El cambio ya está vigente — no requirió votación.');
        router.replace('/rules');
        return;
      }

      const { error: rpcError } = await supabase.rpc('propose_rule_change', {
        p_group_id: group.id,
        p_changes,
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
      Alert.alert('No se pudo enviar el cambio', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>
          Deja en blanco lo que no quieras cambiar — se queda igual a como está hoy.
          {isAdmin && applyMode === 'vote' ? ' La propuesta necesita mayoría de votos a favor para aplicarse.' : ''}
        </Text>

        <View style={styles.form}>
          {isAdmin ? (
            <View style={styles.timingField}>
              <Text style={styles.timingLabel}>¿Cómo quieres aplicar este cambio?</Text>
              <SegmentedControl options={APPLY_MODE_OPTIONS} value={applyMode} onChange={setApplyMode} />
            </View>
          ) : null}
          <View style={styles.timingField}>
            <Text style={styles.timingLabel}>Modo de juego</Text>
            <SegmentedControl options={PAYOUT_MODE_OPTIONS} value={payoutMode} onChange={setPayoutMode} />
            <Text style={styles.modeDescription}>{PAYOUT_MODE_DESCRIPTIONS[effectiveMode]}</Text>
          </View>
          {isFieldRelevantForMode('attendanceRules', effectiveMode) ? (
            <>
              <TextField
                label="Nuevos días mínimos por semana"
                hint={RULE_FIELD_HELP.minDaysPerWeek}
                value={minDaysPerWeek}
                onChangeText={setMinDaysPerWeek}
                keyboardType="numeric"
                placeholder={group ? String(group.min_days_per_week) : ''}
              />
              <TextField
                label="Nueva penalización por día fallado (COP)"
                hint={RULE_FIELD_HELP.penaltyAmount}
                value={penaltyAmount}
                onChangeText={setPenaltyAmount}
                keyboardType="numeric"
                placeholder={group ? group.penalty_amount.toLocaleString('es-CO') : ''}
              />
              <TextField
                label="Nuevo tope de multa por semana (COP)"
                hint={RULE_FIELD_HELP.weeklyPenaltyCap}
                value={weeklyPenaltyCap}
                onChangeText={setWeeklyPenaltyCap}
                keyboardType="numeric"
                placeholder={group ? group.weekly_penalty_cap.toLocaleString('es-CO') : ''}
              />
            </>
          ) : null}
          <TextField
            label="Nueva cuota por salir sin aviso (COP)"
            hint={RULE_FIELD_HELP.exitFeeAmount}
            value={exitFeeAmount}
            onChangeText={setExitFeeAmount}
            keyboardType="numeric"
            placeholder={group ? group.exit_fee_amount.toLocaleString('es-CO') : ''}
          />
          <TextField
            label="Nuevos días de aviso para salir sin costo"
            hint={RULE_FIELD_HELP.exitNoticeDays}
            value={exitNoticeDays}
            onChangeText={setExitNoticeDays}
            keyboardType="numeric"
            placeholder={group ? String(group.exit_notice_days) : ''}
          />
          <View style={styles.timingField}>
            <Text style={styles.timingLabel}>¿Exigir foto final al terminar el entreno?</Text>
            <Text style={styles.modeDescription}>{RULE_FIELD_HELP.requireCheckoutPhoto}</Text>
            <SegmentedControl
              options={CHECKOUT_TOGGLE_OPTIONS}
              value={requireCheckoutPhoto}
              onChange={setRequireCheckoutPhoto}
            />
          </View>
          <TextField
            label="Nueva duración mínima del entreno (minutos)"
            hint={RULE_FIELD_HELP.minWorkoutMinutes}
            value={minWorkoutMinutes}
            onChangeText={setMinWorkoutMinutes}
            keyboardType="numeric"
            placeholder={group ? String(group.min_workout_minutes) : ''}
          />
          {isFieldRelevantForMode('leagueConfig', effectiveMode) ? (
            <>
              <TextField
                label="Duración del ciclo de Liga (meses)"
                hint={RULE_FIELD_HELP.leagueDurationMonths}
                value={leagueDurationMonths}
                onChangeText={setLeagueDurationMonths}
                keyboardType="numeric"
                placeholder={group ? String(group.league_duration_months) : ''}
              />
              <View>
                {group ? (
                  <Text style={styles.currentValue}>
                    Actual: {group.league_prize_splits.map((v) => `${v}%`).join(' / ')}
                  </Text>
                ) : null}
                <PrizeSplitEditor values={leaguePrizeSplits} onChange={setLeaguePrizeSplits} />
              </View>
            </>
          ) : null}
          {isFieldRelevantForMode('mixedShare', effectiveMode) ? (
            <TextField
              label="¿Qué % del fondo se destina al premio de Liga?"
              hint={RULE_FIELD_HELP.mixedLeagueSharePercent}
              value={mixedLeagueSharePercent}
              onChangeText={setMixedLeagueSharePercent}
              keyboardType="numeric"
              placeholder={group ? String(group.mixed_league_share_percent) : ''}
            />
          ) : null}
          {!isAdmin || applyMode === 'vote' ? (
            <View style={styles.timingField}>
              <Text style={styles.timingLabel}>¿Cuándo debe aplicar el cambio si se aprueba?</Text>
              <SegmentedControl options={TIMING_OPTIONS} value={timing} onChange={setTiming} />
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={isAdmin && applyMode === 'direct' ? 'Aplicar cambio' : 'Enviar propuesta'}
            onPress={handleSubmit}
            loading={isSubmitting}
          />
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
  modeDescription: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  currentValue: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  error: { color: colors.danger },
});
