import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { MoneyField } from '@/components/ui/MoneyField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PrizeSplitEditor } from '@/components/ui/PrizeSplitEditor';
import { TimezonePicker } from '@/components/ui/TimezonePicker';
import { InlineDatePicker } from '@/components/ui/InlineDatePicker';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase/client';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { createGroupSchema } from '@/lib/validation/schemas';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { PAYOUT_MODE_DESCRIPTIONS, PAYOUT_MODE_LABELS, isFieldRelevantForMode } from '@/constants/payoutModes';
import { RULE_FIELD_HELP } from '@/constants/ruleFieldHelp';
import { DEFAULT_GROUP_TIMEZONE } from '@/constants/timezones';
import type { PayoutMode } from '@/lib/supabase/types';
import { colors, spacing, typography } from '@/constants/theme';

const YES_NO_OPTIONS: { key: 'yes' | 'no'; label: string }[] = [
  { key: 'no', label: 'No' },
  { key: 'yes', label: 'Sí' },
];

const PAYOUT_MODE_OPTIONS: { key: PayoutMode; label: string }[] = (
  ['cooperative', 'league', 'mixed'] as const
).map((key) => ({ key, label: PAYOUT_MODE_LABELS[key] }));

// Used whenever a field is left blank — chosen to match the most common
// setup across existing groups, not arbitrary round numbers.
const DEFAULTS = {
  initialDepositAmount: 100000,
  minDaysPerWeek: 3,
  penaltyAmount: 20000,
  weeklyPenaltyCap: 60000,
  exitFeeAmount: 0,
  exitNoticeDays: 0,
  minWorkoutMinutes: 0,
};

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/** Blank field -> the default; a typed value (including an explicit "0") always wins. */
function numberOrDefault(raw: string, fallback: number): number {
  return raw ? Number(raw) : fallback;
}

export default function CreateGroupScreen() {
  const { session } = useAuth();
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);

  const [name, setName] = useState('');
  const [initialDepositAmount, setInitialDepositAmount] = useState('');
  const [minDaysPerWeek, setMinDaysPerWeek] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [weeklyPenaltyCap, setWeeklyPenaltyCap] = useState('');
  const [exitFeeAmount, setExitFeeAmount] = useState('');
  const [exitNoticeDays, setExitNoticeDays] = useState('');
  const [requireCheckoutPhoto, setRequireCheckoutPhoto] = useState<'yes' | 'no'>('no');
  const [minWorkoutMinutes, setMinWorkoutMinutes] = useState('');
  const [adminPaymentInfo, setAdminPaymentInfo] = useState('');
  const [payoutMode, setPayoutMode] = useState<PayoutMode>('cooperative');
  const [leagueDurationMonths, setLeagueDurationMonths] = useState('');
  const [leaguePrizeSplits, setLeaguePrizeSplits] = useState<string[]>(['60', '30', '10']);
  const [mixedLeagueSharePercent, setMixedLeagueSharePercent] = useState('');
  const [hasGameStartDate, setHasGameStartDate] = useState<'yes' | 'no'>('no');
  const [gameStartsAtDate, setGameStartsAtDate] = useState(new Date());
  const [timezone, setTimezone] = useState(DEFAULT_GROUP_TIMEZONE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const result = createGroupSchema.safeParse({
      name,
      initialDepositAmount: numberOrDefault(initialDepositAmount, DEFAULTS.initialDepositAmount),
      minDaysPerWeek: numberOrDefault(minDaysPerWeek, DEFAULTS.minDaysPerWeek),
      penaltyAmount: numberOrDefault(penaltyAmount, DEFAULTS.penaltyAmount),
      weeklyPenaltyCap: numberOrDefault(weeklyPenaltyCap, DEFAULTS.weeklyPenaltyCap),
      exitFeeAmount: numberOrDefault(exitFeeAmount, DEFAULTS.exitFeeAmount),
      exitNoticeDays: numberOrDefault(exitNoticeDays, DEFAULTS.exitNoticeDays),
      requireCheckoutPhoto: requireCheckoutPhoto === 'yes',
      minWorkoutMinutes: numberOrDefault(minWorkoutMinutes, DEFAULTS.minWorkoutMinutes),
      adminPaymentInfo,
      payoutMode,
      leagueDurationMonths: leagueDurationMonths ? Number(leagueDurationMonths) : undefined,
      leaguePrizeSplits: leaguePrizeSplits.filter((v) => v.trim()).map(Number),
      mixedLeagueSharePercent: mixedLeagueSharePercent ? Number(mixedLeagueSharePercent) : undefined,
      gameStartsAt: hasGameStartDate === 'yes' ? toZonedDateString(gameStartsAtDate, timezone) : '',
      timezone,
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
        p_payout_mode: result.data.payoutMode,
        p_league_duration_months: result.data.leagueDurationMonths,
        p_league_prize_splits: result.data.leaguePrizeSplits,
        p_mixed_league_share_percent: result.data.mixedLeagueSharePercent,
        p_game_starts_at: result.data.gameStartsAt || null,
        p_timezone: result.data.timezone,
      });
      if (error || !data) throw new Error(error?.message ?? 'No se pudo crear el grupo');
      setActiveGroupId(data.id);

      // The creator is their own admin — there's no one else for them to send
      // a transfer to or wait on for approval, so their own initial deposit
      // is auto-confirmed instead of routing them through the same
      // upload-a-receipt-then-approve-it flow regular joining members use.
      // If this one extra call fails for any reason, the group itself is
      // already created successfully — fall back to the normal deposit
      // screen rather than blocking on it.
      if (session?.user.id) {
        const { error: confirmError } = await supabase.rpc('admin_confirm_deposit_without_receipt', {
          p_group_id: data.id,
          p_user_id: session.user.id,
        });
        if (!confirmError) {
          router.replace('/home');
          return;
        }
      }
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
        <Button label="Volver" variant="secondary" onPress={() => router.back()} />

        <Text style={styles.subtitle}>
          Define las reglas iniciales. Cualquier cambio futuro necesitará el voto de la mayoría del grupo. Deja un
          campo vacío para usar el valor sugerido.
        </Text>

        <View>
          <SectionLabel>INFORMACIÓN BÁSICA</SectionLabel>
          <Card style={styles.section}>
            <TextField label="Nombre del grupo" value={name} onChangeText={setName} error={errors.name} />
          </Card>
        </View>

        <View>
          <SectionLabel>ZONA HORARIA</SectionLabel>
          <Card style={styles.section}>
            <Text style={styles.modeDescription}>
              Define en qué día/semana cuenta cada check-in del grupo, y qué festivos aplican para el logro &ldquo;Festivo
              Cumplido&rdquo;.
            </Text>
            <TimezonePicker value={timezone} onChange={setTimezone} />
            {errors.timezone ? <Text style={styles.errorText}>{errors.timezone}</Text> : null}
          </Card>
        </View>

        <View>
          <SectionLabel>MODO DE JUEGO</SectionLabel>
          <Card style={styles.section}>
            <SegmentedControl options={PAYOUT_MODE_OPTIONS} value={payoutMode} onChange={setPayoutMode} size="lg" />
            <Text style={styles.modeDescription}>{PAYOUT_MODE_DESCRIPTIONS[payoutMode]}</Text>
            <View style={styles.toggleField}>
              <Text style={styles.toggleLabel}>¿El grupo empieza a jugar en una fecha futura?</Text>
              <Text style={styles.toggleHint}>{RULE_FIELD_HELP.gameStartsAt}</Text>
              <SegmentedControl options={YES_NO_OPTIONS} value={hasGameStartDate} onChange={setHasGameStartDate} />
              {hasGameStartDate === 'yes' ? (
                <InlineDatePicker value={gameStartsAtDate} onChange={setGameStartsAtDate} minimumDate={new Date()} />
              ) : null}
            </View>
            {errors.gameStartsAt ? <Text style={styles.errorText}>{errors.gameStartsAt}</Text> : null}
            {isFieldRelevantForMode('leagueConfig', payoutMode) ? (
              <>
                <TextField
                  label="Duración del ciclo de Liga (meses)"
                  hint={RULE_FIELD_HELP.leagueDurationMonths}
                  value={leagueDurationMonths}
                  onChangeText={setLeagueDurationMonths}
                  keyboardType="numeric"
                  placeholder="3"
                  error={errors.leagueDurationMonths}
                />
                <PrizeSplitEditor values={leaguePrizeSplits} onChange={setLeaguePrizeSplits} />
              </>
            ) : null}
            {isFieldRelevantForMode('mixedShare', payoutMode) ? (
              <TextField
                label="¿Qué % del fondo se destina al premio de Liga?"
                hint={RULE_FIELD_HELP.mixedLeagueSharePercent}
                value={mixedLeagueSharePercent}
                onChangeText={setMixedLeagueSharePercent}
                keyboardType="numeric"
                placeholder="50"
                error={errors.mixedLeagueSharePercent}
              />
            ) : null}
          </Card>
        </View>

        <View>
          <SectionLabel>DEPÓSITO Y MULTAS</SectionLabel>
          <Card style={styles.section}>
            <MoneyField
              label="Depósito inicial (COP)"
              hint={RULE_FIELD_HELP.initialDepositAmount}
              value={initialDepositAmount}
              onChangeValue={setInitialDepositAmount}
              defaultValue={DEFAULTS.initialDepositAmount}
              error={errors.initialDepositAmount}
            />
            {isFieldRelevantForMode('attendanceRules', payoutMode) ? (
              <>
                <TextField
                  label="Días mínimos de gym por semana"
                  hint={RULE_FIELD_HELP.minDaysPerWeek}
                  value={minDaysPerWeek}
                  onChangeText={setMinDaysPerWeek}
                  keyboardType="numeric"
                  placeholder={String(DEFAULTS.minDaysPerWeek)}
                  error={errors.minDaysPerWeek}
                />
                <MoneyField
                  label="Penalización por día fallado (COP)"
                  hint={RULE_FIELD_HELP.penaltyAmount}
                  value={penaltyAmount}
                  onChangeValue={setPenaltyAmount}
                  defaultValue={DEFAULTS.penaltyAmount}
                  error={errors.penaltyAmount}
                />
                <MoneyField
                  label="Tope de multa por semana (COP)"
                  hint={RULE_FIELD_HELP.weeklyPenaltyCap}
                  value={weeklyPenaltyCap}
                  onChangeValue={setWeeklyPenaltyCap}
                  defaultValue={DEFAULTS.weeklyPenaltyCap}
                  error={errors.weeklyPenaltyCap}
                />
              </>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionLabel>ENTRENAMIENTO</SectionLabel>
          <Card style={styles.section}>
            <View style={styles.toggleField}>
              <Text style={styles.toggleLabel}>¿Exigir foto final al terminar el entreno?</Text>
              <Text style={styles.toggleHint}>{RULE_FIELD_HELP.requireCheckoutPhoto}</Text>
              <SegmentedControl options={YES_NO_OPTIONS} value={requireCheckoutPhoto} onChange={setRequireCheckoutPhoto} />
            </View>
            <TextField
              label="Duración mínima del entreno (minutos)"
              hint={RULE_FIELD_HELP.minWorkoutMinutes}
              value={minWorkoutMinutes}
              onChangeText={setMinWorkoutMinutes}
              keyboardType="numeric"
              placeholder={String(DEFAULTS.minWorkoutMinutes)}
              error={errors.minWorkoutMinutes}
            />
          </Card>
        </View>

        <View>
          <SectionLabel>SALIDA DEL GRUPO</SectionLabel>
          <Card style={styles.section}>
            <MoneyField
              label="Cuota por salir sin aviso (COP)"
              hint={RULE_FIELD_HELP.exitFeeAmount}
              value={exitFeeAmount}
              onChangeValue={setExitFeeAmount}
              defaultValue={DEFAULTS.exitFeeAmount}
              error={errors.exitFeeAmount}
            />
            <TextField
              label="Días de aviso para salir sin costo"
              hint={RULE_FIELD_HELP.exitNoticeDays}
              value={exitNoticeDays}
              onChangeText={setExitNoticeDays}
              keyboardType="numeric"
              placeholder={String(DEFAULTS.exitNoticeDays)}
              error={errors.exitNoticeDays}
            />
          </Card>
        </View>

        <View>
          <SectionLabel>DATOS DE PAGO</SectionLabel>
          <Card style={styles.section}>
            <TextField
              label="Datos de pago (Nequi, Bancolombia, etc.)"
              hint={RULE_FIELD_HELP.adminPaymentInfo}
              value={adminPaymentInfo}
              onChangeText={setAdminPaymentInfo}
              placeholder="Ej: Nequi 300 123 4567"
              error={errors.adminPaymentInfo}
            />
          </Card>
        </View>

        <Button label="Crear grupo" onPress={handleSubmit} loading={isSubmitting} />

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
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  section: { gap: spacing.md },
  modeDescription: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  errorText: { color: colors.danger, fontSize: 12 },
  toggleField: { gap: spacing.xs },
  toggleLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  toggleHint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  link: { alignSelf: 'center', marginVertical: spacing.lg },
  linkText: { color: colors.primary, fontWeight: '600' },
});
