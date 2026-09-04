import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { MoneyField } from '@/components/ui/MoneyField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { PrizeSplitEditor } from '@/components/ui/PrizeSplitEditor';
import { TimezonePicker } from '@/components/ui/TimezonePicker';
import { InlineDatePicker } from '@/components/ui/InlineDatePicker';
import { StepProgress } from '@/components/ui/StepProgress';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase/client';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { createGroupSchema } from '@/lib/validation/schemas';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { PAYOUT_MODE_DESCRIPTIONS, PAYOUT_MODE_LABELS, isFieldRelevantForMode } from '@/constants/payoutModes';
import { RULE_FIELD_HELP } from '@/constants/ruleFieldHelp';
import { DEFAULT_GROUP_TIMEZONE, groupTimezoneLabel } from '@/constants/timezones';
import type { PayoutMode } from '@/lib/supabase/types';
import { colors, radii, spacing } from '@/constants/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type StepKey = 'basic' | 'timezone' | 'mode' | 'money' | 'rules' | 'payment' | 'review';

const YES_NO_OPTIONS: { key: 'yes' | 'no'; label: string }[] = [
  { key: 'no', label: 'No' },
  { key: 'yes', label: 'Sí' },
];

// UI-only gate — hides the toggle for everyone else. The real authority is
// server-side (create_group checks profiles.is_platform_admin), so this
// never needs to be kept in sync with anything beyond "who sees the option".
const PLATFORM_ADMIN_EMAIL = 'tomasmosquera@hotmail.com';

const PAYOUT_MODE_OPTIONS: { key: PayoutMode; label: string }[] = (
  ['cooperative', 'league', 'mixed'] as const
).map((key) => ({ key, label: PAYOUT_MODE_LABELS[key] }));

const MODE_ICONS: Record<PayoutMode, IconName> = {
  cooperative: 'people-outline',
  league: 'trophy-outline',
  mixed: 'layers-outline',
};

// Used whenever a field is left blank — chosen to match the most common
// setup across existing groups, not arbitrary round numbers.
const DEFAULTS = {
  initialDepositAmount: 100000,
  minDaysPerWeek: 3,
  penaltyAmount: 20000,
  weeklyPenaltyCap: 60000,
  exitFeeAmount: 0,
  enrollmentFeeAmount: 0,
  exitNoticeDays: 0,
  minWorkoutMinutes: 0,
};

const STEPS: { key: StepKey; title: string; subtitle: string; icon: IconName }[] = [
  {
    key: 'basic',
    title: 'Información básica',
    subtitle: 'Cómo se va a llamar tu grupo.',
    icon: 'information-circle-outline',
  },
  {
    key: 'timezone',
    title: 'Zona horaria',
    subtitle: 'Define en qué día/semana cuenta cada check-in y qué festivos aplican para los logros.',
    icon: 'time-outline',
  },
  {
    key: 'mode',
    title: 'Modo de juego',
    subtitle: 'Cómo se reparte el fondo común entre los miembros.',
    icon: 'trophy-outline',
  },
  {
    key: 'money',
    title: 'Depósito y multas',
    subtitle: 'Cuánto pone cada quien al entrar y qué pasa si alguien falla un día.',
    icon: 'cash-outline',
  },
  {
    key: 'rules',
    title: 'Reglas adicionales',
    subtitle: 'Foto de cierre, duración mínima del entreno y condiciones de salida.',
    icon: 'barbell-outline',
  },
  {
    key: 'payment',
    title: 'Datos de pago',
    subtitle: 'Cómo te transfieren los demás miembros su depósito y sus multas.',
    icon: 'card-outline',
  },
  {
    key: 'review',
    title: 'Revisar y crear',
    subtitle: 'Confirma todo antes de crear el grupo. Cualquier cambio futuro necesitará el voto de la mayoría.',
    icon: 'checkmark-done-outline',
  },
];

// Which step owns each schema field — used to jump the wizard back to the
// right step when the final submit finds a validation error on a field
// that isn't on the step currently in view.
const STEP_FOR_FIELD: Record<string, StepKey> = {
  name: 'basic',
  isPublic: 'basic',
  timezone: 'timezone',
  payoutMode: 'mode',
  gameStartsAt: 'mode',
  leagueDurationMonths: 'mode',
  leaguePrizeSplits: 'mode',
  mixedLeagueSharePercent: 'mode',
  descensoRankCount: 'mode',
  descensoPenaltyAmount: 'mode',
  initialDepositAmount: 'money',
  enrollmentFeeAmount: 'money',
  minDaysPerWeek: 'money',
  penaltyAmount: 'money',
  weeklyPenaltyCap: 'money',
  requireCheckoutPhoto: 'rules',
  minWorkoutMinutes: 'rules',
  exitFeeAmount: 'rules',
  exitNoticeDays: 'rules',
  adminPaymentInfo: 'payment',
};

/** Blank field -> the default; a typed value (including an explicit "0") always wins. */
function numberOrDefault(raw: string, fallback: number): number {
  return raw ? Number(raw) : fallback;
}

function ModeCard({
  label,
  description,
  icon,
  selected,
  onPress,
}: {
  label: string;
  description: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.modeCard, selected && styles.modeCardSelected]}>
      <View style={[styles.modeIconWrap, selected && styles.modeIconWrapSelected]}>
        <Ionicons name={icon} size={22} color={selected ? colors.primaryText : colors.primary} />
      </View>
      <View style={styles.modeCardBody}>
        <Text style={[styles.modeCardTitle, selected && styles.modeCardTitleSelected]}>{label}</Text>
        <Text style={styles.modeCardDescription}>{description}</Text>
      </View>
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>{selected ? <View style={styles.radioInner} /> : null}</View>
    </Pressable>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <Card style={styles.reviewCard}>
      <View style={styles.reviewSectionHeader}>
        <Text style={styles.reviewSectionTitle}>{title}</Text>
        <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button">
          <Text style={styles.reviewEdit}>Editar</Text>
        </Pressable>
      </View>
      {children}
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

export default function CreateGroupScreen() {
  const { session, refreshProfile } = useAuth();
  const setActiveGroupId = useActiveGroupStore((s) => s.setActiveGroupId);

  const [stepIndex, setStepIndex] = useState(0);

  const [name, setName] = useState('');
  const [initialDepositAmount, setInitialDepositAmount] = useState('');
  const [minDaysPerWeek, setMinDaysPerWeek] = useState('');
  const [penaltyAmount, setPenaltyAmount] = useState('');
  const [weeklyPenaltyCap, setWeeklyPenaltyCap] = useState('');
  const [exitFeeAmount, setExitFeeAmount] = useState('');
  const [enrollmentFeeAmount, setEnrollmentFeeAmount] = useState('');
  const [exitNoticeDays, setExitNoticeDays] = useState('');
  const [requireCheckoutPhoto, setRequireCheckoutPhoto] = useState<'yes' | 'no'>('no');
  const [minWorkoutMinutes, setMinWorkoutMinutes] = useState('');
  const [adminPaymentInfo, setAdminPaymentInfo] = useState('');
  const [payoutMode, setPayoutMode] = useState<PayoutMode>('cooperative');
  const [leagueDurationMonths, setLeagueDurationMonths] = useState('');
  const [leaguePrizeSplits, setLeaguePrizeSplits] = useState<string[]>(['60', '30', '10']);
  const [mixedLeagueSharePercent, setMixedLeagueSharePercent] = useState('');
  const [descensoRankCount, setDescensoRankCount] = useState('');
  const [descensoPenaltyAmount, setDescensoPenaltyAmount] = useState('');
  const [hasGameStartDate, setHasGameStartDate] = useState<'yes' | 'no'>('no');
  const [gameStartsAtDate, setGameStartsAtDate] = useState(new Date());
  const [timezone, setTimezone] = useState(DEFAULT_GROUP_TIMEZONE);
  const [isPublic, setIsPublic] = useState<'yes' | 'no'>('no');
  const [adminParticipates, setAdminParticipates] = useState<'yes' | 'no'>('yes');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canMakePublic = session?.user.email === PLATFORM_ADMIN_EMAIL;
  const currentStep = STEPS[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === STEPS.length - 1;

  const goNext = () => {
    if (currentStep.key === 'basic') {
      if (name.trim().length < 3) {
        setErrors((prev) => ({ ...prev, name: 'El nombre debe tener al menos 3 caracteres' }));
        return;
      }
      setErrors((prev) => {
        if (!prev.name) return prev;
        const { name: _name, ...rest } = prev;
        return rest;
      });
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0));
  const jumpTo = (key: StepKey) => setStepIndex(STEPS.findIndex((s) => s.key === key));

  const handleSubmit = async () => {
    const result = createGroupSchema.safeParse({
      name,
      initialDepositAmount: numberOrDefault(initialDepositAmount, DEFAULTS.initialDepositAmount),
      minDaysPerWeek: numberOrDefault(minDaysPerWeek, DEFAULTS.minDaysPerWeek),
      penaltyAmount: numberOrDefault(penaltyAmount, DEFAULTS.penaltyAmount),
      weeklyPenaltyCap: numberOrDefault(weeklyPenaltyCap, DEFAULTS.weeklyPenaltyCap),
      exitFeeAmount: numberOrDefault(exitFeeAmount, DEFAULTS.exitFeeAmount),
      enrollmentFeeAmount: numberOrDefault(enrollmentFeeAmount, DEFAULTS.enrollmentFeeAmount),
      exitNoticeDays: numberOrDefault(exitNoticeDays, DEFAULTS.exitNoticeDays),
      requireCheckoutPhoto: requireCheckoutPhoto === 'yes',
      minWorkoutMinutes: numberOrDefault(minWorkoutMinutes, DEFAULTS.minWorkoutMinutes),
      adminPaymentInfo,
      payoutMode,
      leagueDurationMonths: leagueDurationMonths ? Number(leagueDurationMonths) : undefined,
      leaguePrizeSplits: leaguePrizeSplits.filter((v) => v.trim()).map(Number),
      mixedLeagueSharePercent: mixedLeagueSharePercent ? Number(mixedLeagueSharePercent) : undefined,
      descensoRankCount: descensoRankCount ? Number(descensoRankCount) : undefined,
      descensoPenaltyAmount: descensoPenaltyAmount ? Number(descensoPenaltyAmount) : undefined,
      gameStartsAt: hasGameStartDate === 'yes' ? toZonedDateString(gameStartsAtDate, timezone) : '',
      timezone,
      isPublic: canMakePublic && isPublic === 'yes',
    });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
      setErrors(fieldErrors);
      const erroredStepKey = STEPS.find((s) => Object.keys(fieldErrors).some((f) => STEP_FOR_FIELD[f] === s.key))?.key;
      if (erroredStepKey) jumpTo(erroredStepKey);
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
        p_is_public: result.data.isPublic,
        p_descenso_rank_count: result.data.descensoRankCount,
        p_descenso_penalty_amount: result.data.descensoPenaltyAmount,
        p_enrollment_fee_amount: result.data.enrollmentFeeAmount,
        p_admin_participates: adminParticipates === 'yes',
      });
      if (error || !data) throw new Error(error?.message ?? 'No se pudo crear el grupo');
      setActiveGroupId(data.id);
      // create_group just spent one of this user's credits — refresh so
      // "Cambiar de grupo" doesn't show a stale count on the way back there.
      refreshProfile().catch(() => {});

      // An admin who chose not to participate was created directly as
      // 'admin_only' — no deposit to confirm, nothing to fall back to.
      if (adminParticipates === 'no') {
        router.replace('/profile/invite');
        return;
      }

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
          // Straight to inviting people — an empty group with no one else in
          // it yet isn't a very useful place to land on.
          router.replace('/profile/invite');
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

  const effectiveDeposit = numberOrDefault(initialDepositAmount, DEFAULTS.initialDepositAmount);
  const effectiveEnrollmentFee = numberOrDefault(enrollmentFeeAmount, DEFAULTS.enrollmentFeeAmount);
  const effectiveMinDays = numberOrDefault(minDaysPerWeek, DEFAULTS.minDaysPerWeek);
  const effectivePenalty = numberOrDefault(penaltyAmount, DEFAULTS.penaltyAmount);
  const effectiveWeeklyCap = numberOrDefault(weeklyPenaltyCap, DEFAULTS.weeklyPenaltyCap);
  const effectiveExitFee = numberOrDefault(exitFeeAmount, DEFAULTS.exitFeeAmount);
  const effectiveExitNoticeDays = numberOrDefault(exitNoticeDays, DEFAULTS.exitNoticeDays);
  const effectiveMinWorkoutMinutes = numberOrDefault(minWorkoutMinutes, DEFAULTS.minWorkoutMinutes);
  const showAttendanceRules = isFieldRelevantForMode('attendanceRules', payoutMode);
  const showLeagueConfig = isFieldRelevantForMode('leagueConfig', payoutMode);
  const showMixedShare = isFieldRelevantForMode('mixedShare', payoutMode);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.progressWrap}>
        <StepProgress total={STEPS.length} currentIndex={stepIndex} />
        <Text style={styles.progressText}>
          Paso {stepIndex + 1} de {STEPS.length}
        </Text>
      </View>

      <ScrollView key={stepIndex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SectionHeader icon={currentStep.icon} title={currentStep.title} />
        <Text style={styles.stepSubtitle}>{currentStep.subtitle}</Text>

        {currentStep.key === 'basic' ? (
          <>
            <Card style={styles.stepCard}>
              <TextField
                label="Nombre del grupo"
                placeholder="Ej: Los Madrugadores"
                value={name}
                onChangeText={setName}
                error={errors.name}
              />
            </Card>
            <Card style={styles.stepCard}>
              <View style={styles.toggleField}>
                <Text style={styles.toggleLabel}>¿Vas a participar tú también, o solo vas a administrar?</Text>
                <Text style={styles.toggleHint}>
                  Al participar, también depositas, entrenas y te evalúan como a cualquier miembro. Si solo
                  administras, no depositas ni te exigen días de entreno — quedas fuera del ranking y del reparto del
                  fondo, con todos los permisos de administrador.
                </Text>
                <SegmentedControl
                  options={[
                    { key: 'yes', label: 'Voy a participar' },
                    { key: 'no', label: 'Solo administrar' },
                  ]}
                  value={adminParticipates}
                  onChange={setAdminParticipates}
                />
              </View>
            </Card>
            {canMakePublic ? (
              <Card style={styles.stepCard}>
                <View style={styles.toggleField}>
                  <Text style={styles.toggleLabel}>¿Grupo público?</Text>
                  <Text style={styles.toggleHint}>
                    Cualquiera podrá encontrarlo y unirse desde &ldquo;Mis grupos → Unirme a un grupo público&rdquo;, sin
                    código de invitación.
                  </Text>
                  <SegmentedControl options={YES_NO_OPTIONS} value={isPublic} onChange={setIsPublic} />
                </View>
              </Card>
            ) : null}
          </>
        ) : null}

        {currentStep.key === 'timezone' ? (
          <Card style={styles.stepCard}>
            <TimezonePicker value={timezone} onChange={setTimezone} />
            {errors.timezone ? <Text style={styles.errorText}>{errors.timezone}</Text> : null}
          </Card>
        ) : null}

        {currentStep.key === 'mode' ? (
          <>
            <View style={styles.modeCardList}>
              {PAYOUT_MODE_OPTIONS.map((opt) => (
                <ModeCard
                  key={opt.key}
                  label={opt.label}
                  description={PAYOUT_MODE_DESCRIPTIONS[opt.key]}
                  icon={MODE_ICONS[opt.key]}
                  selected={payoutMode === opt.key}
                  onPress={() => setPayoutMode(opt.key)}
                />
              ))}
            </View>

            <Card style={styles.stepCard}>
              <View style={styles.toggleField}>
                <Text style={styles.toggleLabel}>¿El grupo empieza a jugar en una fecha futura?</Text>
                <Text style={styles.toggleHint}>{RULE_FIELD_HELP.gameStartsAt}</Text>
                <SegmentedControl options={YES_NO_OPTIONS} value={hasGameStartDate} onChange={setHasGameStartDate} />
                {hasGameStartDate === 'yes' ? (
                  <InlineDatePicker
                    value={gameStartsAtDate}
                    onChange={setGameStartsAtDate}
                    minimumDate={new Date()}
                    wide
                  />
                ) : null}
              </View>
              {errors.gameStartsAt ? <Text style={styles.errorText}>{errors.gameStartsAt}</Text> : null}
            </Card>

            {showLeagueConfig ? (
              <Card style={styles.stepCard}>
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
              </Card>
            ) : null}

            {showMixedShare ? (
              <Card style={styles.stepCard}>
                <TextField
                  label="¿Qué % del fondo se destina al premio de Liga?"
                  hint={RULE_FIELD_HELP.mixedLeagueSharePercent}
                  value={mixedLeagueSharePercent}
                  onChangeText={setMixedLeagueSharePercent}
                  keyboardType="numeric"
                  placeholder="50"
                  error={errors.mixedLeagueSharePercent}
                />
              </Card>
            ) : null}

            {/* Descenso only exists in pure Liga — Mixto already charges a real
                per-missed-day penalty, so it doesn't need this too. */}
            {payoutMode === 'league' ? (
              <Card style={styles.stepCard}>
                <TextField
                  label="Jugadores en zona de descenso"
                  hint={RULE_FIELD_HELP.descensoRankCount}
                  value={descensoRankCount}
                  onChangeText={setDescensoRankCount}
                  keyboardType="numeric"
                  placeholder="0"
                  error={errors.descensoRankCount}
                />
                <MoneyField
                  label="Multa por descenso (COP)"
                  hint={RULE_FIELD_HELP.descensoPenaltyAmount}
                  value={descensoPenaltyAmount}
                  onChangeValue={setDescensoPenaltyAmount}
                  defaultValue={0}
                  error={errors.descensoPenaltyAmount}
                />
              </Card>
            ) : null}
          </>
        ) : null}

        {currentStep.key === 'money' ? (
          <>
            <Card style={styles.stepCard}>
              <MoneyField
                label="Depósito inicial (COP)"
                hint={RULE_FIELD_HELP.initialDepositAmount}
                value={initialDepositAmount}
                onChangeValue={setInitialDepositAmount}
                defaultValue={DEFAULTS.initialDepositAmount}
                error={errors.initialDepositAmount}
              />
              <MoneyField
                label="Cuota de inscripción (COP)"
                hint={RULE_FIELD_HELP.enrollmentFeeAmount}
                value={enrollmentFeeAmount}
                onChangeValue={setEnrollmentFeeAmount}
                defaultValue={DEFAULTS.enrollmentFeeAmount}
                error={errors.enrollmentFeeAmount}
              />
            </Card>
            {showAttendanceRules ? (
              <Card style={styles.stepCard}>
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
              </Card>
            ) : null}
          </>
        ) : null}

        {currentStep.key === 'rules' ? (
          <>
            <Card style={styles.stepCard}>
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
            <Card style={styles.stepCard}>
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
          </>
        ) : null}

        {currentStep.key === 'payment' ? (
          <Card style={styles.stepCard}>
            <TextField
              label="Datos de pago (Nequi, Bancolombia, etc.)"
              hint={RULE_FIELD_HELP.adminPaymentInfo}
              value={adminPaymentInfo}
              onChangeText={setAdminPaymentInfo}
              placeholder="Ej: Nequi 300 123 4567"
              error={errors.adminPaymentInfo}
            />
          </Card>
        ) : null}

        {currentStep.key === 'review' ? (
          <>
            <ReviewSection title="Información básica" onEdit={() => jumpTo('basic')}>
              <ReviewRow label="Nombre" value={name.trim() || '—'} />
              <ReviewRow label="Tu rol" value={adminParticipates === 'yes' ? 'Administrador y participante' : 'Solo administrador'} />
              {canMakePublic ? <ReviewRow label="Grupo público" value={isPublic === 'yes' ? 'Sí' : 'No'} /> : null}
            </ReviewSection>

            <ReviewSection title="Zona horaria" onEdit={() => jumpTo('timezone')}>
              <ReviewRow label="Zona horaria" value={groupTimezoneLabel(timezone)} />
            </ReviewSection>

            <ReviewSection title="Modo de juego" onEdit={() => jumpTo('mode')}>
              <ReviewRow label="Modo" value={PAYOUT_MODE_LABELS[payoutMode]} />
              <ReviewRow
                label="Inicio del juego"
                value={hasGameStartDate === 'yes' ? gameStartsAtDate.toLocaleDateString('es-CO') : 'Inmediato'}
              />
              {showLeagueConfig ? (
                <>
                  <ReviewRow
                    label="Duración del ciclo"
                    value={`${leagueDurationMonths || 3} mes(es)`}
                  />
                  <ReviewRow label="Premio por puesto" value={leaguePrizeSplits.filter((v) => v.trim()).map((v) => `${v}%`).join(' · ') || '—'} />
                </>
              ) : null}
              {showMixedShare ? (
                <ReviewRow label="% del fondo a Liga" value={`${mixedLeagueSharePercent || 50}%`} />
              ) : null}
              {payoutMode === 'league' ? (
                <>
                  <ReviewRow label="Jugadores en descenso" value={descensoRankCount || '0'} />
                  <ReviewRow
                    label="Multa por descenso"
                    value={`COP ${numberOrDefault(descensoPenaltyAmount, 0).toLocaleString('es-CO')}`}
                  />
                </>
              ) : null}
            </ReviewSection>

            <ReviewSection title="Depósito y multas" onEdit={() => jumpTo('money')}>
              <ReviewRow label="Depósito inicial" value={`COP ${effectiveDeposit.toLocaleString('es-CO')}`} />
              <ReviewRow label="Cuota de inscripción" value={`COP ${effectiveEnrollmentFee.toLocaleString('es-CO')}`} />
              {showAttendanceRules ? (
                <>
                  <ReviewRow label="Días mínimos por semana" value={String(effectiveMinDays)} />
                  <ReviewRow label="Penalización por día fallado" value={`COP ${effectivePenalty.toLocaleString('es-CO')}`} />
                  <ReviewRow label="Tope de multa semanal" value={`COP ${effectiveWeeklyCap.toLocaleString('es-CO')}`} />
                </>
              ) : null}
            </ReviewSection>

            <ReviewSection title="Reglas adicionales" onEdit={() => jumpTo('rules')}>
              <ReviewRow label="Foto final obligatoria" value={requireCheckoutPhoto === 'yes' ? 'Sí' : 'No'} />
              <ReviewRow label="Duración mínima del entreno" value={`${effectiveMinWorkoutMinutes} min`} />
              <ReviewRow label="Cuota por salir sin aviso" value={`COP ${effectiveExitFee.toLocaleString('es-CO')}`} />
              <ReviewRow label="Días de aviso para salir gratis" value={String(effectiveExitNoticeDays)} />
            </ReviewSection>

            <ReviewSection title="Datos de pago" onEdit={() => jumpTo('payment')}>
              <ReviewRow label="Datos de pago" value={adminPaymentInfo.trim() || 'No especificado'} />
            </ReviewSection>
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerBtnSecondary}>
          <Button label="Atrás" variant="secondary" onPress={goBack} disabled={isFirstStep} />
        </View>
        <View style={styles.footerBtnPrimary}>
          {isLastStep ? (
            <Button label="Crear grupo" onPress={handleSubmit} loading={isSubmitting} />
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
  toggleHint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  errorText: { color: colors.danger, fontSize: 12 },
  modeCardList: { gap: spacing.sm },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  modeCardSelected: { borderColor: colors.primary, backgroundColor: 'rgba(61, 220, 151, 0.08)' },
  modeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(61, 220, 151, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeIconWrapSelected: { backgroundColor: colors.primary },
  modeCardBody: { flex: 1, gap: 2 },
  modeCardTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  modeCardTitleSelected: { color: colors.primary },
  modeCardDescription: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: colors.primary },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  reviewCard: { gap: spacing.sm },
  reviewSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewSectionTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  reviewEdit: { color: colors.primary, fontWeight: '600', fontSize: 13 },
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
