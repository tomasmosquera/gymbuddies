import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { InlineDatePicker } from '@/components/ui/InlineDatePicker';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PrizeSplitEditor } from '@/components/ui/PrizeSplitEditor';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StepProgress } from '@/components/ui/StepProgress';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useLeagueCycle } from '@/hooks/useLeagueCycle';
import { supabase } from '@/lib/supabase/client';
import { ruleProposalSchema } from '@/lib/validation/schemas';
import { PAYOUT_MODE_DESCRIPTIONS, PAYOUT_MODE_LABELS, isFieldRelevantForMode } from '@/constants/payoutModes';
import { RULE_FIELD_HELP } from '@/constants/ruleFieldHelp';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import type { PayoutMode } from '@/lib/supabase/types';
import { colors, spacing } from '@/constants/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type StepKey = 'applyMode' | 'mode' | 'attendance' | 'rules' | 'league' | 'timing' | 'review';

const TIMING_OPTIONS: { key: 'immediate' | 'next_week'; label: string }[] = [
  { key: 'next_week', label: 'La próxima semana' },
  { key: 'immediate', label: 'De inmediato' },
];

const APPLY_MODE_OPTIONS: { key: 'vote' | 'direct'; label: string }[] = [
  { key: 'vote', label: 'Proponer y votar' },
  { key: 'direct', label: 'Aplicar directamente' },
];

const YES_NO_OPTIONS: { key: 'yes' | 'no'; label: string }[] = [
  { key: 'no', label: 'No' },
  { key: 'yes', label: 'Sí' },
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
  const { cycle } = useLeagueCycle(group?.id ?? null);
  const [minDaysPerWeek, setMinDaysPerWeek] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [weeklyPenaltyCap, setWeeklyPenaltyCap] = useState('');
  const [exitFeeAmount, setExitFeeAmount] = useState('');
  const [enrollmentFeeAmount, setEnrollmentFeeAmount] = useState('');
  const [exitNoticeDays, setExitNoticeDays] = useState('');
  const [requireCheckoutPhoto, setRequireCheckoutPhoto] = useState<'no_change' | 'yes' | 'no'>('no_change');
  const [minWorkoutMinutes, setMinWorkoutMinutes] = useState('');
  const [payoutMode, setPayoutMode] = useState<'no_change' | PayoutMode>('no_change');
  const [leagueDurationMonths, setLeagueDurationMonths] = useState('');
  const [leaguePrizeSplits, setLeaguePrizeSplits] = useState<string[]>([]);
  const [mixedLeagueSharePercent, setMixedLeagueSharePercent] = useState('');
  const [descensoRankCount, setDescensoRankCount] = useState('');
  const [descensoPenaltyAmount, setDescensoPenaltyAmount] = useState('');
  const [changeLeagueCycleStart, setChangeLeagueCycleStart] = useState<'yes' | 'no'>('no');
  const [leagueCycleStartDate, setLeagueCycleStartDate] = useState(new Date());
  const [timing, setTiming] = useState<'immediate' | 'next_week'>('next_week');
  const [applyMode, setApplyMode] = useState<'vote' | 'direct'>('vote');
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Starts unset rather than baked in at mount — useActiveGroup's membership
  // (and so isAdmin) can still be loading on the very first render, and a
  // useState initializer only ever runs once, so seeding it from isAdmin
  // directly would freeze in whatever role happened to be known at that
  // instant. null just means "show steps[0]", which stays correct as isAdmin
  // (and so the step list itself) resolves.
  const [stepKey, setStepKey] = useState<StepKey | null>(null);

  const effectiveMode: PayoutMode = payoutMode === 'no_change' ? (group?.payout_mode ?? 'cooperative') : payoutMode;
  const showAttendanceRules = isFieldRelevantForMode('attendanceRules', effectiveMode);
  const showLeagueConfig = isFieldRelevantForMode('leagueConfig', effectiveMode);
  const showMixedShare = isFieldRelevantForMode('mixedShare', effectiveMode);
  const showEnrollmentFee = isAdmin && applyMode === 'direct';

  useEffect(() => {
    if (cycle) setLeagueCycleStartDate(new Date(cycle.started_at));
  }, [cycle]);

  const steps = useMemo(() => {
    const list: { key: StepKey; title: string; subtitle: string; icon: IconName }[] = [];
    list.push({
      key: 'mode',
      title: 'Modo de juego',
      subtitle: 'Deja "Sin cambio" si no quieres tocar cómo se reparte el fondo.',
      icon: 'trophy-outline',
    });
    list.push({
      key: 'attendance',
      title: 'Asistencia y multas',
      subtitle: 'Deja en blanco lo que no quieras cambiar — se queda igual a como está hoy.',
      icon: 'cash-outline',
    });
    list.push({
      key: 'rules',
      title: 'Reglas adicionales',
      subtitle: 'Foto de cierre, duración mínima del entreno y condiciones de salida.',
      icon: 'barbell-outline',
    });
    if (showLeagueConfig) {
      list.push({
        key: 'league',
        title: 'Configuración de Liga',
        subtitle: 'Duración del ciclo, reparto de premios y, si aplica, zona de descenso.',
        icon: 'ribbon-outline',
      });
    }
    // Last content step, right before the review — how (and, if it's going
    // to a vote, when) this gets applied is the final call to make, not the
    // opening one.
    if (isAdmin) {
      list.push({
        key: 'applyMode',
        title: 'Cómo aplicar el cambio',
        subtitle: 'Como admin puedes aplicarlo directo, o mandarlo a votación como cualquier miembro.',
        icon: 'shield-checkmark-outline',
      });
    }
    if (!isAdmin || applyMode === 'vote') {
      list.push({
        key: 'timing',
        title: '¿Cuándo aplica?',
        subtitle: 'Si la propuesta se aprueba, decide desde cuándo entra en vigencia.',
        icon: 'time-outline',
      });
    }
    list.push({
      key: 'review',
      title: 'Revisar y enviar',
      subtitle:
        isAdmin && applyMode === 'direct'
          ? 'Confirma los cambios — se aplican de inmediato, sin votación.'
          : 'Confirma los cambios antes de mandarlos a votación del grupo.',
      icon: 'checkmark-done-outline',
    });
    return list;
  }, [isAdmin, applyMode, showLeagueConfig]);

  const stepIndex = stepKey === null ? 0 : Math.max(0, steps.findIndex((s) => s.key === stepKey));
  const currentStep = steps[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === steps.length - 1;

  const goNext = () => setStepKey(steps[Math.min(stepIndex + 1, steps.length - 1)].key);
  const goBack = () => setStepKey(steps[Math.max(stepIndex - 1, 0)].key);

  const handleSubmit = async () => {
    if (!group) return;
    const changes = {
      minDaysPerWeek: minDaysPerWeek ? Number(minDaysPerWeek) : undefined,
      penaltyAmount: penaltyAmount ? Number(penaltyAmount) : undefined,
      weeklyPenaltyCap: weeklyPenaltyCap ? Number(weeklyPenaltyCap) : undefined,
      exitFeeAmount: exitFeeAmount ? Number(exitFeeAmount) : undefined,
      // Admin-direct only, never votable — apply_rule_proposal (the vote
      // outcome applier) doesn't even read this key server-side any more,
      // but this guard also keeps it from ever reaching propose_rule_change
      // in the first place, so a leftover value from switching apply modes
      // never sneaks into a vote proposal.
      enrollmentFeeAmount: showEnrollmentFee && enrollmentFeeAmount ? Number(enrollmentFeeAmount) : undefined,
      exitNoticeDays: exitNoticeDays ? Number(exitNoticeDays) : undefined,
      requireCheckoutPhoto: requireCheckoutPhoto === 'no_change' ? undefined : requireCheckoutPhoto === 'yes',
      minWorkoutMinutes: minWorkoutMinutes ? Number(minWorkoutMinutes) : undefined,
      payoutMode: payoutMode === 'no_change' ? undefined : payoutMode,
      leagueDurationMonths: leagueDurationMonths ? Number(leagueDurationMonths) : undefined,
      leaguePrizeSplits: leaguePrizeSplits.length > 0 ? leaguePrizeSplits.map(Number) : undefined,
      mixedLeagueSharePercent: mixedLeagueSharePercent ? Number(mixedLeagueSharePercent) : undefined,
      descensoRankCount: descensoRankCount ? Number(descensoRankCount) : undefined,
      descensoPenaltyAmount: descensoPenaltyAmount ? Number(descensoPenaltyAmount) : undefined,
      leagueCycleStartedAt:
        changeLeagueCycleStart === 'yes' && group ? toZonedDateString(leagueCycleStartDate, group.timezone) : undefined,
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
        ...(result.data.enrollmentFeeAmount !== undefined && {
          enrollment_fee_amount: result.data.enrollmentFeeAmount,
        }),
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
        ...(result.data.descensoRankCount !== undefined && { descenso_rank_count: result.data.descensoRankCount }),
        ...(result.data.descensoPenaltyAmount !== undefined && {
          descenso_penalty_amount: result.data.descensoPenaltyAmount,
        }),
        ...(result.data.leagueCycleStartedAt !== undefined && {
          league_cycle_started_at: result.data.leagueCycleStartedAt,
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

  // Only the fields actually filled in — everything else stays "sin cambio",
  // so the review step should read as "esto es lo que sí vas a cambiar", not
  // a full restatement of every field in the form. applyMode/timing are
  // deliberately never in here — they're not proposed rule changes, just how
  // this submission itself gets applied (both have a real default value, so
  // counting them would make an untouched form look like it had changes,
  // and would leave "Enviar" enabled with nothing actually proposed).
  const changeRows: { label: string; value: string }[] = [];
  if (payoutMode !== 'no_change') changeRows.push({ label: 'Modo de juego', value: PAYOUT_MODE_LABELS[payoutMode] });
  if (minDaysPerWeek) changeRows.push({ label: 'Días mínimos por semana', value: minDaysPerWeek });
  if (penaltyAmount) changeRows.push({ label: 'Penalización por día fallado', value: `COP ${Number(penaltyAmount).toLocaleString('es-CO')}` });
  if (weeklyPenaltyCap) changeRows.push({ label: 'Tope de multa semanal', value: `COP ${Number(weeklyPenaltyCap).toLocaleString('es-CO')}` });
  if (showEnrollmentFee && enrollmentFeeAmount) changeRows.push({ label: 'Cuota de inscripción', value: `COP ${Number(enrollmentFeeAmount).toLocaleString('es-CO')}` });
  if (requireCheckoutPhoto !== 'no_change') changeRows.push({ label: 'Foto final obligatoria', value: requireCheckoutPhoto === 'yes' ? 'Sí' : 'No' });
  if (minWorkoutMinutes) changeRows.push({ label: 'Duración mínima del entreno', value: `${minWorkoutMinutes} min` });
  if (exitFeeAmount) changeRows.push({ label: 'Cuota por salir sin aviso', value: `COP ${Number(exitFeeAmount).toLocaleString('es-CO')}` });
  if (exitNoticeDays) changeRows.push({ label: 'Días de aviso para salir gratis', value: exitNoticeDays });
  if (leagueDurationMonths) changeRows.push({ label: 'Duración del ciclo de Liga', value: `${leagueDurationMonths} mes(es)` });
  if (leaguePrizeSplits.some((v) => v.trim())) {
    changeRows.push({ label: 'Premio por puesto', value: leaguePrizeSplits.filter((v) => v.trim()).map((v) => `${v}%`).join(' · ') });
  }
  if (showMixedShare && mixedLeagueSharePercent) changeRows.push({ label: '% del fondo a Liga', value: `${mixedLeagueSharePercent}%` });
  if (descensoRankCount) changeRows.push({ label: 'Jugadores en descenso', value: descensoRankCount });
  if (descensoPenaltyAmount) changeRows.push({ label: 'Multa por descenso', value: `COP ${Number(descensoPenaltyAmount).toLocaleString('es-CO')}` });
  if (changeLeagueCycleStart === 'yes') changeRows.push({ label: 'Nueva fecha de inicio del ciclo', value: leagueCycleStartDate.toLocaleDateString('es-CO') });

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.progressWrap}>
        <StepProgress total={steps.length} currentIndex={stepIndex} />
        <Text style={styles.progressText}>
          Paso {stepIndex + 1} de {steps.length}
        </Text>
      </View>

      <ScrollView key={stepKey} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SectionHeader icon={currentStep.icon} title={currentStep.title} />
        <Text style={styles.stepSubtitle}>{currentStep.subtitle}</Text>

        {currentStep.key === 'applyMode' ? (
          <Card style={styles.stepCard}>
            <SegmentedControl options={APPLY_MODE_OPTIONS} value={applyMode} onChange={setApplyMode} />
          </Card>
        ) : null}

        {currentStep.key === 'mode' ? (
          <Card style={styles.stepCard}>
            <SegmentedControl options={PAYOUT_MODE_OPTIONS} value={payoutMode} onChange={setPayoutMode} />
            <Text style={styles.hint}>{PAYOUT_MODE_DESCRIPTIONS[effectiveMode]}</Text>
          </Card>
        ) : null}

        {currentStep.key === 'attendance' ? (
          <>
            {showAttendanceRules ? (
              <Card style={styles.stepCard}>
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
              </Card>
            ) : null}
            {/* Admin-only, never votable — this field only exists in the
                direct-apply path, so members proposing a vote never see it. */}
            {showEnrollmentFee ? (
              <Card style={styles.stepCard}>
                <TextField
                  label="Nueva cuota de inscripción (COP)"
                  hint={RULE_FIELD_HELP.enrollmentFeeAmount}
                  value={enrollmentFeeAmount}
                  onChangeText={setEnrollmentFeeAmount}
                  keyboardType="numeric"
                  placeholder={group ? group.enrollment_fee_amount.toLocaleString('es-CO') : ''}
                />
              </Card>
            ) : null}
            {!showAttendanceRules && !showEnrollmentFee ? (
              <Text style={styles.hint}>Este modo no usa multas por asistencia.</Text>
            ) : null}
          </>
        ) : null}

        {currentStep.key === 'rules' ? (
          <>
            <Card style={styles.stepCard}>
              <View style={styles.toggleField}>
                <Text style={styles.toggleLabel}>¿Exigir foto final al terminar el entreno?</Text>
                <Text style={styles.hint}>{RULE_FIELD_HELP.requireCheckoutPhoto}</Text>
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
            </Card>
            <Card style={styles.stepCard}>
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
            </Card>
          </>
        ) : null}

        {currentStep.key === 'league' ? (
          <>
            <Card style={styles.stepCard}>
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
            </Card>
            {showMixedShare ? (
              <Card style={styles.stepCard}>
                <TextField
                  label="¿Qué % del fondo se destina al premio de Liga?"
                  hint={RULE_FIELD_HELP.mixedLeagueSharePercent}
                  value={mixedLeagueSharePercent}
                  onChangeText={setMixedLeagueSharePercent}
                  keyboardType="numeric"
                  placeholder={group ? String(group.mixed_league_share_percent) : ''}
                />
              </Card>
            ) : null}
            {/* Descenso only exists in pure Liga — Mixto already charges a real
                per-missed-day penalty, so it doesn't need this too. */}
            {effectiveMode === 'league' ? (
              <Card style={styles.stepCard}>
                <TextField
                  label="Nuevos jugadores en zona de descenso"
                  hint={RULE_FIELD_HELP.descensoRankCount}
                  value={descensoRankCount}
                  onChangeText={setDescensoRankCount}
                  keyboardType="numeric"
                  placeholder={group ? String(group.descenso_rank_count) : ''}
                />
                <TextField
                  label="Nueva multa por descenso (COP)"
                  hint={RULE_FIELD_HELP.descensoPenaltyAmount}
                  value={descensoPenaltyAmount}
                  onChangeText={setDescensoPenaltyAmount}
                  keyboardType="numeric"
                  placeholder={group ? group.descenso_penalty_amount.toLocaleString('es-CO') : ''}
                />
              </Card>
            ) : null}
            {cycle ? (
              <Card style={styles.stepCard}>
                <View style={styles.toggleField}>
                  <Text style={styles.toggleLabel}>¿Cambiar la fecha de inicio del ciclo actual?</Text>
                  <Text style={styles.hint}>{RULE_FIELD_HELP.leagueCycleStartedAt}</Text>
                  <SegmentedControl
                    options={YES_NO_OPTIONS}
                    value={changeLeagueCycleStart}
                    onChange={setChangeLeagueCycleStart}
                  />
                  {changeLeagueCycleStart === 'yes' ? (
                    <InlineDatePicker
                      label="Nueva fecha de inicio"
                      value={leagueCycleStartDate}
                      onChange={setLeagueCycleStartDate}
                      wide
                    />
                  ) : null}
                </View>
              </Card>
            ) : null}
          </>
        ) : null}

        {currentStep.key === 'timing' ? (
          <Card style={styles.stepCard}>
            <SegmentedControl options={TIMING_OPTIONS} value={timing} onChange={setTiming} />
          </Card>
        ) : null}

        {currentStep.key === 'review' ? (
          <>
            <Card style={styles.stepCard}>
              <Text style={styles.hint}>
                {isAdmin && applyMode === 'direct'
                  ? 'Se aplica de inmediato, sin votación.'
                  : `Se manda a votación del grupo. Si se aprueba, aplica ${
                      timing === 'immediate' ? 'de inmediato' : 'la próxima semana'
                    }.`}
              </Text>
            </Card>
            <Card style={styles.stepCard}>
              {changeRows.length === 0 ? (
                <Text style={styles.hint}>No has propuesto ningún cambio todavía — vuelve atrás y ajusta algo.</Text>
              ) : (
                changeRows.map((row, i) => (
                  <View key={i} style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>{row.label}</Text>
                    <Text style={styles.reviewValue}>{row.value}</Text>
                  </View>
                ))
              )}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </Card>
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerBtnSecondary}>
          <Button label="Atrás" variant="secondary" onPress={goBack} disabled={isFirstStep} />
        </View>
        <View style={styles.footerBtnPrimary}>
          {isLastStep ? (
            <Button
              label={isAdmin && applyMode === 'direct' ? 'Aplicar cambio' : 'Enviar propuesta'}
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={changeRows.length === 0}
            />
          ) : (
            <Button label="Continuar" onPress={goNext} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  progressWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  progressText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  container: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  stepSubtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  stepCard: { gap: spacing.md },
  toggleField: { gap: spacing.xs },
  toggleLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  currentValue: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  error: { color: colors.danger },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, gap: spacing.md },
  reviewLabel: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  reviewValue: { color: colors.text, fontWeight: '600', fontSize: 13, textAlign: 'right' },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  footerBtnSecondary: { flex: 1 },
  footerBtnPrimary: { flex: 2 },
});
