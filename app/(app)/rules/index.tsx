import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useRuleProposal } from '@/hooks/useRuleProposal';
import { useExcuseVote } from '@/hooks/useExcuseVote';
import { usePhotoChallenges } from '@/hooks/usePhotoChallenges';
import { usePendingKothClaims } from '@/hooks/usePendingKothClaims';
import { useGroupMembers } from '@/hooks/useGroupMembers';
import { useLeagueCycle } from '@/hooks/useLeagueCycle';
import { useLeagueCycleHistory } from '@/hooks/useLeagueCycleHistory';
import { useMyActiveExcuses } from '@/hooks/useMyActiveExcuses';
import { CrownIcon } from '@/components/ui/CrownIcon';
import { supabase } from '@/lib/supabase/client';
import { CheckinPhotoColumn } from '@/components/checkin/CheckinPhotoColumn';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { ZoomableImageModal } from '@/components/ui/ZoomableImageModal';
import { KothVideoModal } from '@/components/koth/KothVideoModal';
import { VoteBreakdown, type VoteBreakdownPerson } from '@/components/rules/VoteBreakdown';
import type { GroupMemberWithProfile } from '@/hooks/useGroupMembers';
import { formatKothValue } from '@/lib/domain/koth';
import { getSignedUrl } from '@/lib/supabase/storage';
import { formatZonedDateTime12h, toZonedDateString } from '@/lib/domain/dateUtils';
import {
  canCancelEarlyClose,
  canCloseEarly,
  cycleBoundaryDate,
  earlyCloseSunday,
  formatDateOnly,
} from '@/lib/domain/leagueCycle';
import { toCycleResults } from '@/lib/domain/leagueResults';
import { LeagueCycleResultsModal } from '@/components/rules/LeagueCycleResultsModal';
import { PAYOUT_MODE_DESCRIPTIONS, PAYOUT_MODE_LABELS, isFieldRelevantForMode } from '@/constants/payoutModes';
import { colors, radii, spacing, typography } from '@/constants/theme';

const EXCUSE_TYPE_LABELS: Record<string, string> = {
  travel: 'Viaje',
  medical: 'Médica',
  other: 'Otro motivo',
};

const CHANGE_LABELS: Record<string, string> = {
  min_days_per_week: 'Días mínimos por semana',
  penalty_amount: 'Penalización por día fallado',
  weekly_penalty_cap: 'Tope de multa por semana',
  exit_fee_amount: 'Cuota por salir sin aviso',
  enrollment_fee_amount: 'Cuota de inscripción',
  exit_notice_days: 'Días de aviso para salir sin costo',
  require_checkout_photo: 'Foto final requerida',
  min_workout_minutes: 'Duración mínima del entreno (min)',
  payout_mode: 'Modo de juego',
  league_duration_weeks: 'Duración del ciclo de Liga (semanas)',
  league_auto_renew: 'Renovar ciclo de Liga automáticamente',
  // Legacy key: proposals created before the months -> weeks change still carry it.
  league_duration_months: 'Duración del ciclo de Liga (meses)',
  league_prize_splits: 'Premio por puesto',
  mixed_league_share_percent: '% del fondo para el premio de Liga',
  league_cycle_started_at: 'Fecha de inicio del ciclo de Liga',
  descenso_rank_count: 'Jugadores en zona de descenso',
  descenso_penalty_amount: 'Multa por descenso',
};

const MONEY_CHANGE_FIELDS = new Set([
  'penalty_amount',
  'weekly_penalty_cap',
  'exit_fee_amount',
  'descenso_penalty_amount',
  'enrollment_fee_amount',
]);
const BOOLEAN_CHANGE_FIELDS = new Set(['require_checkout_photo', 'league_auto_renew']);
const PAYOUT_MODE_FIELDS = new Set(['payout_mode']);
const PERCENT_ARRAY_FIELDS = new Set(['league_prize_splits']);
const DATE_CHANGE_FIELDS = new Set(['league_cycle_started_at']);

/** "7 de agosto" for a single day, "7 al 9 de agosto" for a range. */
function formatExcuseRange({ startDate, endDate }: { startDate: string; endDate: string }): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  const start = new Date(`${startDate}T00:00:00Z`).toLocaleDateString('es-CO', opts);
  if (startDate === endDate) return start;
  return `${start} al ${new Date(`${endDate}T00:00:00Z`).toLocaleDateString('es-CO', opts)}`;
}

/** Whole days remaining until `dateString` (never negative — the day it becomes effective still reads as 0, not -1). */
function daysUntil(dateString: string): number {
  const ms = new Date(dateString).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

// Same status list is_voting_member()/is_active_participant() effectively
// gate voting on server-side — pending_deposit already fully participates
// (see 0039), only left/removed/admin_only can never vote.
const VOTING_STATUSES = new Set(['pending_deposit', 'active', 'needs_recharge']);

/**
 * Splits the eligible voter pool for one open vote into who voted yes, who
 * voted no, and who hasn't voted yet — for the "A favor / En contra / Faltan
 * por votar" breakdown (VoteBreakdown). `eligible` should already exclude
 * anyone who genuinely can't vote on this specific thing (the photo's own
 * subject, a KOTH claimant, a member who joined after the vote opened) —
 * this function only sorts by vote, it doesn't decide eligibility itself.
 */
function bucketVotes(
  eligible: readonly GroupMemberWithProfile[],
  votes: readonly { user_id: string; vote: string }[]
): { yes: VoteBreakdownPerson[]; no: VoteBreakdownPerson[]; pending: VoteBreakdownPerson[] } {
  const voteByUserId = new Map(votes.map((v) => [v.user_id, v.vote]));
  const yes: VoteBreakdownPerson[] = [];
  const no: VoteBreakdownPerson[] = [];
  const pending: VoteBreakdownPerson[] = [];
  for (const m of eligible) {
    const person = { userId: m.user_id, fullName: m.profile.full_name };
    const vote = voteByUserId.get(m.user_id);
    if (vote === 'yes') yes.push(person);
    else if (vote === 'no') no.push(person);
    else pending.push(person);
  }
  return { yes, no, pending };
}

function formatChangeValue(key: string, value: unknown): string {
  if (BOOLEAN_CHANGE_FIELDS.has(key)) {
    return value ? 'Sí' : 'No';
  }
  if (MONEY_CHANGE_FIELDS.has(key) && typeof value === 'number') {
    return value.toLocaleString('es-CO');
  }
  if (PAYOUT_MODE_FIELDS.has(key)) {
    return (PAYOUT_MODE_LABELS as Record<string, string>)[String(value)] ?? String(value);
  }
  if (PERCENT_ARRAY_FIELDS.has(key) && Array.isArray(value)) {
    return value.map((v) => `${v}%`).join(' / ');
  }
  if (DATE_CHANGE_FIELDS.has(key) && typeof value === 'string') {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  return String(value);
}

export default function RulesScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading, refresh: refreshGroup } = useActiveGroup();
  const {
    proposal,
    votes: proposalVotes,
    yesCount,
    noCount,
    myVote,
    upcomingChange,
    isLoading: proposalLoading,
    castVote,
    refresh: refreshProposal,
  } = useRuleProposal(group?.id ?? null, session?.user.id ?? null);
  const {
    request: excuseVoteRequest,
    votes: excuseVotes,
    yesCount: excuseYesCount,
    noCount: excuseNoCount,
    myVote: myExcuseVote,
    isLoading: excuseVoteLoading,
    castVote: castExcuseVote,
    refresh: refreshExcuseVote,
  } = useExcuseVote(group?.id ?? null, session?.user.id ?? null);
  const {
    challenges,
    isLoading: challengesLoading,
    refresh: refreshChallenges,
    castVote: castChallengeVote,
    adminDecide,
  } = usePhotoChallenges(group?.id ?? null);
  const {
    claims: kothClaims,
    isLoading: kothClaimsLoading,
    refresh: refreshKothClaims,
    castVote: castKothVote,
    adminDecide: adminDecideKoth,
  } = usePendingKothClaims(group?.id ?? null);
  const { members, isLoading: membersLoading, refresh: refreshMembers } = useGroupMembers(group?.id ?? null);
  const { ranges: myActiveExcuses, refresh: refreshMyActiveExcuses } = useMyActiveExcuses(
    group?.id ?? null,
    session?.user.id ?? null,
    toZonedDateString(new Date(), group?.timezone ?? 'America/Bogota')
  );
  const {
    cycle: leagueCycle,
    isLoading: leagueCycleLoading,
    refresh: refreshLeagueCycle,
    startCycle: startLeagueCycle,
    closeEarly: closeLeagueCycleEarly,
    cancelEarlyClose: cancelLeagueCycleEarlyClose,
  } = useLeagueCycle(group?.id ?? null);
  const { history: leagueHistory, refresh: refreshLeagueHistory } = useLeagueCycleHistory(group?.id ?? null);
  const [showAllCycles, setShowAllCycles] = useState(false);
  const [resultsCycleId, setResultsCycleId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCancellingLeave, setIsCancellingLeave] = useState(false);
  const [isStartingCycle, setIsStartingCycle] = useState(false);
  const [isChangingEarlyClose, setIsChangingEarlyClose] = useState(false);
  const [viewingPhotoPath, setViewingPhotoPath] = useState<string | null>(null);
  const [excuseProofItems, setExcuseProofItems] = useState<{ url: string; path: string }[]>([]);
  const [viewingExcuseProof, setViewingExcuseProof] = useState<{ url: string; path: string } | null>(null);
  const [viewingKothVideoPath, setViewingKothVideoPath] = useState<string | null>(null);

  useEffect(() => {
    const paths = excuseVoteRequest?.proof_paths ?? [];
    if (paths.length === 0) {
      setExcuseProofItems([]);
      return;
    }
    Promise.all(paths.map((p) => getSignedUrl('excuse-proofs', p).then((url) => ({ url, path: p }))))
      .then(setExcuseProofItems)
      .catch(() => setExcuseProofItems([]));
  }, [excuseVoteRequest?.proof_paths]);

  // This tab stays mounted across switches — without refetching on focus,
  // a proposal/excuse/photo vote resolved or cast elsewhere would keep
  // showing stale state here until a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      refreshGroup();
      refreshProposal();
      refreshExcuseVote();
      refreshChallenges();
      refreshKothClaims();
      refreshMembers();
      refreshLeagueCycle();
      refreshLeagueHistory();
      refreshMyActiveExcuses();
    }, [
      refreshGroup,
      refreshProposal,
      refreshExcuseVote,
      refreshChallenges,
      refreshKothClaims,
      refreshMembers,
      refreshLeagueCycle,
      refreshLeagueHistory,
      refreshMyActiveExcuses,
    ])
  );

  if (
    groupLoading ||
    proposalLoading ||
    excuseVoteLoading ||
    challengesLoading ||
    kothClaimsLoading ||
    membersLoading ||
    leagueCycleLoading ||
    !group ||
    !membership
  ) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isAdmin = membership.role === 'admin';

  const handleVote = async (vote: 'yes' | 'no') => {
    try {
      await castVote(vote);
    } catch (err) {
      Alert.alert('No se pudo votar', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleExcuseVote = async (vote: 'yes' | 'no') => {
    try {
      await castExcuseVote(vote);
    } catch (err) {
      Alert.alert('No se pudo votar', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleChallengeVote = async (challengeId: string, vote: 'yes' | 'no') => {
    try {
      await castChallengeVote(challengeId, vote);
    } catch (err) {
      Alert.alert('No se pudo votar', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleAdminDecide = async (challengeId: string, valid: boolean) => {
    try {
      await adminDecide(challengeId, valid);
    } catch (err) {
      Alert.alert('No se pudo decidir', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleKothVote = async (claimId: string, vote: 'yes' | 'no') => {
    try {
      await castKothVote(claimId, vote);
    } catch (err) {
      Alert.alert('No se pudo votar', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleKothAdminDecide = async (claimId: string, valid: boolean) => {
    try {
      await adminDecideKoth(claimId, valid);
    } catch (err) {
      Alert.alert('No se pudo decidir', err instanceof Error ? err.message : 'Intenta de nuevo');
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refreshGroup(),
        refreshProposal(),
        refreshExcuseVote(),
        refreshChallenges(),
        refreshKothClaims(),
        refreshMembers(),
        refreshLeagueCycle(),
        refreshLeagueHistory(),
        refreshMyActiveExcuses(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
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

  const handleCloseLeagueCycleEarly = () => {
    if (!group) return;
    const sunday = formatDateOnly(earlyCloseSunday(new Date(), group.timezone));
    Alert.alert(
      'Cerrar la Liga antes de tiempo',
      `El ciclo terminará este domingo ${sunday}: ese es el último día que cuenta y el lunes se reparte el premio con las posiciones finales. Se aplica de inmediato, sin votación, y se avisa a todos los integrantes. Puedes cancelarlo hasta que termine la semana. ¿Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar la Liga', style: 'destructive', onPress: () => runEarlyCloseChange(closeLeagueCycleEarly) },
      ]
    );
  };

  const handleStartLeagueCycle = async () => {
    setIsStartingCycle(true);
    try {
      await startLeagueCycle();
    } catch (err) {
      Alert.alert('No se pudo iniciar el ciclo', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsStartingCycle(false);
    }
  };

  const handleCancelLeave = async () => {
    if (!group) return;
    setIsCancellingLeave(true);
    try {
      const { error } = await supabase.rpc('cancel_leave_request', { p_group_id: group.id });
      if (error) throw new Error(error.message);
      await refreshMembers();
    } catch (err) {
      Alert.alert('No se pudo cancelar el aviso', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsCancellingLeave(false);
    }
  };

  const membersLeaving = members.filter(
    (m) => m.leave_requested_at !== null && m.status !== 'left' && m.status !== 'removed'
  );

  return (
    <>
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
    >
      <Card>
        <Text style={styles.cardTitle}>Reglas actuales</Text>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Modo de juego</Text>
          <Text style={styles.ruleValue}>{PAYOUT_MODE_LABELS[group.payout_mode]}</Text>
        </View>
        <Text style={styles.modeDescription}>{PAYOUT_MODE_DESCRIPTIONS[group.payout_mode]}</Text>
        {group.game_starts_at ? (
          <View style={styles.ruleRow}>
            <Text style={styles.ruleLabel}>Fecha de inicio del juego</Text>
            <Text style={styles.ruleValue}>{new Date(group.game_starts_at).toLocaleDateString('es-CO')}</Text>
          </View>
        ) : null}
        {isFieldRelevantForMode('attendanceRules', group.payout_mode) ? (
          <>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>Días mínimos por semana</Text>
              <Text style={styles.ruleValue}>{group.min_days_per_week}</Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>Penalización por día fallado</Text>
              <Text style={styles.ruleValue}>
                {group.currency} {group.penalty_amount.toLocaleString('es-CO')}
              </Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>Tope de multa por semana</Text>
              <Text style={styles.ruleValue}>
                {group.currency} {group.weekly_penalty_cap.toLocaleString('es-CO')}
              </Text>
            </View>
          </>
        ) : null}
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Cuota de inscripción</Text>
          <Text style={styles.ruleValue}>
            {group.currency} {group.enrollment_fee_amount.toLocaleString('es-CO')}
          </Text>
        </View>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Cuota por salir sin aviso</Text>
          <Text style={styles.ruleValue}>
            {group.currency} {group.exit_fee_amount.toLocaleString('es-CO')}
          </Text>
        </View>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Días de aviso para salir sin costo</Text>
          <Text style={styles.ruleValue}>{group.exit_notice_days}</Text>
        </View>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleLabel}>Foto final requerida</Text>
          <Text style={styles.ruleValue}>{group.require_checkout_photo ? 'Sí' : 'No'}</Text>
        </View>
        {group.require_checkout_photo ? (
          <View style={styles.ruleRow}>
            <Text style={styles.ruleLabel}>Duración mínima del entreno</Text>
            <Text style={styles.ruleValue}>{group.min_workout_minutes} min</Text>
          </View>
        ) : null}
        {isFieldRelevantForMode('leagueConfig', group.payout_mode) ? (
          <>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>Duración del ciclo de Liga</Text>
              <Text style={styles.ruleValue}>{group.league_duration_weeks} semana(s)</Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>Renovar ciclo automáticamente</Text>
              <Text style={styles.ruleValue}>{group.league_auto_renew ? 'Sí' : 'No'}</Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>Premio por puesto</Text>
              <Text style={styles.ruleValue}>{group.league_prize_splits.map((v) => `${v}%`).join(' / ')}</Text>
            </View>
          </>
        ) : null}
        {isFieldRelevantForMode('mixedShare', group.payout_mode) ? (
          <View style={styles.ruleRow}>
            <Text style={styles.ruleLabel}>% del fondo para el premio de Liga</Text>
            <Text style={styles.ruleValue}>{group.mixed_league_share_percent}%</Text>
          </View>
        ) : null}
        {/* Descenso only exists in pure Liga — Mixto already charges a real
            per-missed-day penalty, so it doesn't need this too. */}
        {group.payout_mode === 'league' && group.descenso_rank_count > 0 ? (
          <>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>Jugadores en zona de descenso</Text>
              <Text style={styles.ruleValue}>{group.descenso_rank_count}</Text>
            </View>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>Multa por descenso</Text>
              <Text style={styles.ruleValue}>
                {group.currency} {group.descenso_penalty_amount.toLocaleString('es-CO')}
              </Text>
            </View>
          </>
        ) : null}
      </Card>

      {group.payout_mode !== 'cooperative' ? (
        <Card style={styles.proposalCard}>
          <Text style={styles.cardTitle}>Ciclo de Liga</Text>
          {leagueCycle ? (
            <>
              <Text style={styles.changeText}>Ciclo #{leagueCycle.cycle_number} en curso</Text>
              <Text style={styles.tally}>
                Cierra el domingo {formatDateOnly(cycleBoundaryDate(leagueCycle.ends_at, group.timezone))} (faltan{' '}
                {daysUntil(leagueCycle.ends_at)} día{daysUntil(leagueCycle.ends_at) === 1 ? '' : 's'}); el lunes
                siguiente se reparte el premio.
              </Text>
              <Text style={styles.tally}>Duración: {leagueCycle.duration_weeks} semana(s).</Text>
              {leagueCycle.closed_early ? (
                <Text style={styles.cycleNote}>
                  El administrador programó el cierre anticipado de este ciclo (iba a terminar el{' '}
                  {formatDateOnly(cycleBoundaryDate(leagueCycle.original_ends_at ?? leagueCycle.ends_at, group.timezone))}).
                  {group.league_auto_renew ? ' El lunes arranca un ciclo nuevo.' : ' Después la Liga queda en pausa hasta iniciar otro ciclo.'}
                </Text>
              ) : null}
              {isAdmin && canCancelEarlyClose(leagueCycle, new Date()) ? (
                <Button
                  label="Cancelar cierre anticipado"
                  variant="secondary"
                  onPress={() => runEarlyCloseChange(cancelLeagueCycleEarlyClose)}
                  loading={isChangingEarlyClose}
                />
              ) : null}
              {isAdmin && canCloseEarly(leagueCycle, new Date(), group.timezone) ? (
                <Button
                  label="Cerrar el ciclo esta semana"
                  variant="danger"
                  onPress={handleCloseLeagueCycleEarly}
                  loading={isChangingEarlyClose}
                />
              ) : null}
              {leagueCycle.effective_start_date !== cycleBoundaryDate(leagueCycle.started_at, group.timezone) ? (
                <Text style={styles.tally}>
                  Arrancó el {formatDateOnly(leagueCycle.effective_start_date)}; los días anteriores de esa semana se
                  cuentan como excusados para todos.
                </Text>
              ) : null}
              {/* The duration rule above is what the NEXT cycle will use — a cycle that's
                  already running keeps the length it was started with, so say so instead of
                  leaving two different numbers on screen unexplained. */}
              {group && leagueCycle.duration_weeks !== group.league_duration_weeks ? (
                <Text style={styles.cycleNote}>
                  La regla ahora dice {group.league_duration_weeks} semana(s), pero aplica desde el próximo ciclo: este
                  sigue con sus {leagueCycle.duration_weeks}.
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.tally}>No hay un ciclo activo — el reparto de Liga está en pausa.</Text>
              {isAdmin ? (
                <Button label="Iniciar ciclo de Liga" onPress={handleStartLeagueCycle} loading={isStartingCycle} />
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {/* Shown whenever a completed cycle exists, even if the group has since switched to
          Cooperativo — the results of a cycle that already paid out don't stop being true. */}
      {leagueHistory.length > 0 && group ? (
        <Card style={styles.proposalCard}>
          <Text style={styles.cardTitle}>Historial de ciclos de Liga</Text>
          {(showAllCycles ? leagueHistory : leagueHistory.slice(0, 3)).map(({ cycle, standings }) => (
            <View key={cycle.id} style={styles.historyCycle}>
              <View style={styles.historyCycleHeader}>
                <Text style={styles.changeText}>Ciclo #{cycle.cycle_number}</Text>
                <Text style={styles.tally}>
                  {formatDateOnly(cycle.effective_start_date)} –{' '}
                  {formatDateOnly(cycleBoundaryDate(cycle.ends_at, group.timezone))}
                </Text>
              </View>
              {cycle.closed_early ? <Text style={styles.tally}>Cerrado antes de tiempo por el administrador.</Text> : null}
              {cycle.pool_at_payout !== null ? (
                <Text style={styles.tally}>
                  Fondo repartido: {group.currency} {cycle.pool_at_payout.toLocaleString('es-CO')}
                </Text>
              ) : null}
              {standings.length === 0 ? (
                <Text style={styles.tally}>No se repartió premio en este ciclo.</Text>
              ) : (
                <>
                  {standings
                    .filter((s) => s.place === 1)
                    .map((s) => (
                      <View key={s.userId} style={styles.historyRow}>
                        <View style={styles.historyPlace}>
                          <CrownIcon size={18} />
                        </View>
                        <Text style={styles.historyName} numberOfLines={1}>
                          {s.fullName ?? 'Ex miembro'}
                        </Text>
                        {s.prizeAmount > 0 ? (
                          <Text style={styles.historyAmount}>
                            {group.currency} {s.prizeAmount.toLocaleString('es-CO')}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  {standings.some((s) => s.relegated) ? (
                    <Text style={styles.tally}>
                      Zona de descenso: {standings.filter((s) => s.relegated).length} jugador(es).
                    </Text>
                  ) : null}
                  <Button label="Ver resultados completos" variant="secondary" onPress={() => setResultsCycleId(cycle.id)} />
                </>
              )}
            </View>
          ))}
          {leagueHistory.length > 3 ? (
            <Button
              label={showAllCycles ? 'Ver menos' : `Ver todos (${leagueHistory.length})`}
              variant="secondary"
              onPress={() => setShowAllCycles((v) => !v)}
            />
          ) : null}
          <LeagueCycleResultsModal
            variant="past"
            visible={resultsCycleId !== null}
            myUserId={session?.user.id ?? null}
            onClose={() => setResultsCycleId(null)}
            results={(() => {
              const entry = leagueHistory.find((h) => h.cycle.id === resultsCycleId);
              if (!entry) return null;
              return toCycleResults({
                cycleNumber: entry.cycle.cycle_number,
                startDate: entry.cycle.effective_start_date,
                endDate: cycleBoundaryDate(entry.cycle.ends_at, group.timezone),
                closedEarly: entry.cycle.closed_early,
                currency: group.currency,
                poolAmount: entry.cycle.pool_at_payout,
                partial: entry.partial,
                rows: entry.standings,
              });
            })()}
          />
        </Card>
      ) : null}

      {membersLeaving.length > 0 ? (
        <Card style={styles.proposalCard}>
          <Text style={styles.cardTitle}>Salidas en proceso</Text>
          {membersLeaving.map((m) => (
            <View key={m.id} style={styles.leaveRow}>
              <View>
                <Text style={styles.changeText}>{m.profile.full_name}</Text>
                <Text style={styles.tally}>
                  Sale el {new Date(m.leave_effective_at!).toLocaleDateString('es-CO')} (faltan{' '}
                  {daysUntil(m.leave_effective_at!)} día{daysUntil(m.leave_effective_at!) === 1 ? '' : 's'})
                </Text>
              </View>
              {m.user_id === session?.user.id ? (
                <Button label="Cancelar aviso" variant="secondary" onPress={handleCancelLeave} loading={isCancellingLeave} />
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      {proposal ? (
        <Card style={styles.proposalCard}>
          <View style={styles.proposalHeader}>
            <Text style={styles.cardTitle}>Votación de reglas en curso</Text>
            <Badge label={`Cierra ${new Date(proposal.voting_closes_at).toLocaleDateString('es-CO')}`} />
          </View>
          {Object.entries(proposal.proposed_changes).map(([key, value]) => (
            <Text key={key} style={styles.changeText}>
              {CHANGE_LABELS[key] ?? key}: {formatChangeValue(key, value)}
            </Text>
          ))}
          <Text style={styles.timingText}>
            {proposal.apply_immediately
              ? 'Si se aprueba, aplica de inmediato.'
              : 'Si se aprueba, aplica la próxima semana.'}
          </Text>
          <Text style={styles.tally}>
            {yesCount} a favor · {noCount} en contra · se necesitan {proposal.required_votes} votos a favor
          </Text>
          {(() => {
            const { yes, no, pending } = bucketVotes(
              members.filter((m) => VOTING_STATUSES.has(m.status) && m.joined_at <= proposal.created_at),
              proposalVotes
            );
            return <VoteBreakdown favor={yes} contra={no} pending={pending} />;
          })()}
          {myVote ? (
            <Text style={styles.myVote}>Ya votaste: {myVote.vote === 'yes' ? 'a favor' : 'en contra'}</Text>
          ) : (
            <View style={styles.voteButtons}>
              <Button label="Votar a favor" onPress={() => handleVote('yes')} />
              <Button label="Votar en contra" variant="secondary" onPress={() => handleVote('no')} />
            </View>
          )}
        </Card>
      ) : (
        <Button label="Proponer cambio de reglas" variant="secondary" onPress={() => router.push('/rules/propose')} />
      )}

      {upcomingChange ? (
        <Card style={styles.proposalCard}>
          <View style={styles.proposalHeader}>
            <Text style={styles.cardTitle}>Cambio de reglas aprobado</Text>
            <Badge
              label={`Entra en vigor el ${new Date(upcomingChange.effective_at!).toLocaleDateString('es-CO')}`}
              tone="success"
            />
          </View>
          <Text style={styles.tally}>
            La semana en curso se evalúa con las reglas actuales; el cambio se aplica el próximo lunes.
          </Text>
          {Object.entries(upcomingChange.proposed_changes).map(([key, value]) => (
            <Text key={key} style={styles.changeText}>
              {CHANGE_LABELS[key] ?? key}: {formatChangeValue(key, value)}
            </Text>
          ))}
        </Card>
      ) : null}

      {excuseVoteRequest ? (
        <Card style={styles.proposalCard}>
          <View style={styles.proposalHeader}>
            <Text style={styles.cardTitle}>Votación de excusa en curso</Text>
            <Badge
              label={`Cierra ${formatZonedDateTime12h(new Date(excuseVoteRequest.voting_closes_at!), group.timezone)}`}
            />
          </View>
          <Text style={styles.changeText}>
            {excuseVoteRequest.member_name} · {EXCUSE_TYPE_LABELS[excuseVoteRequest.excuse_type] ?? excuseVoteRequest.excuse_type}
          </Text>
          <Text style={styles.changeText}>
            {excuseVoteRequest.requested_start_date} a {excuseVoteRequest.requested_end_date}
          </Text>
          {excuseVoteRequest.reason ? <Text style={styles.changeText}>{excuseVoteRequest.reason}</Text> : null}
          {excuseProofItems.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.excuseProofRow}>
              {excuseProofItems.map((item) => (
                <Pressable key={item.path} onPress={() => setViewingExcuseProof(item)}>
                  <Image
                    source={{ uri: item.url, cacheKey: item.path }}
                    style={styles.excuseProof}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <Text style={styles.tally}>
            {excuseYesCount} a favor · {excuseNoCount} en contra · se necesitan {excuseVoteRequest.required_votes} votos
            a favor
          </Text>
          {(() => {
            const { yes, no, pending } = bucketVotes(
              members.filter((m) => VOTING_STATUSES.has(m.status) && m.joined_at <= excuseVoteRequest.created_at),
              excuseVotes
            );
            return <VoteBreakdown favor={yes} contra={no} pending={pending} />;
          })()}
          {myExcuseVote ? (
            <Text style={styles.myVote}>Ya votaste: {myExcuseVote.vote === 'yes' ? 'a favor' : 'en contra'}</Text>
          ) : (
            <View style={styles.voteButtons}>
              <Button label="Votar a favor" onPress={() => handleExcuseVote('yes')} />
              <Button label="Votar en contra" variant="secondary" onPress={() => handleExcuseVote('no')} />
            </View>
          )}
        </Card>
      ) : null}

      {challenges.map((challenge) => {
        const myVote = challenge.votes.find((v) => v.user_id === session?.user.id) ?? null;
        const isTarget = challenge.target_user_id === session?.user.id;
        const yesCount = challenge.votes.filter((v) => v.vote === 'yes').length;
        const noCount = challenge.votes.filter((v) => v.vote === 'no').length;
        return (
          <Card key={challenge.id} style={styles.proposalCard}>
            <View style={styles.proposalHeader}>
              <Text style={styles.cardTitle}>Votación de foto en curso</Text>
              <Badge label={`Cierra ${new Date(challenge.voting_closes_at).toLocaleDateString('es-CO')}`} />
            </View>
            <Text style={styles.changeText}>
              ¿Es válido el check-in de {challenge.checkin?.profile.full_name ?? 'este miembro'}?
            </Text>
            <Text style={styles.tally}>Retado por: {challenge.challengerName ?? 'un miembro del grupo'}</Text>
            {challenge.reason ? <Text style={styles.changeText}>Motivo: {challenge.reason}</Text> : null}
            {challenge.checkin ? (
              <View style={styles.challengePhotoRow}>
                <CheckinPhotoColumn
                  label="Foto Inicial"
                  photoPath={challenge.checkin.photo_path}
                  capturedAt={challenge.checkin.captured_at}
                  latitude={challenge.checkin.latitude}
                  longitude={challenge.checkin.longitude}
                  timezone={group?.timezone ?? 'America/Bogota'}
                  onPress={() => setViewingPhotoPath(challenge.checkin!.photo_path)}
                />
                {challenge.checkin.checkout_photo_path ? (
                  <CheckinPhotoColumn
                    label="Foto Final"
                    photoPath={challenge.checkin.checkout_photo_path}
                    capturedAt={challenge.checkin.checkout_captured_at}
                    latitude={challenge.checkin.checkout_latitude}
                    longitude={challenge.checkin.checkout_longitude}
                    timezone={group?.timezone ?? 'America/Bogota'}
                    onPress={() => setViewingPhotoPath(challenge.checkin!.checkout_photo_path)}
                  />
                ) : null}
              </View>
            ) : null}
            <Text style={styles.tally}>
              {yesCount} a favor de invalidar · {noCount} en contra · se necesitan {challenge.required_votes} votos
            </Text>
            {(() => {
              const { yes, no, pending } = bucketVotes(
                members.filter((m) => VOTING_STATUSES.has(m.status) && m.user_id !== challenge.target_user_id),
                challenge.votes
              );
              // Inverted vs a plain favor/contra vote: 'yes' here means "vota
              // inválida" (red), 'no' means "vota válida" (green) — see the
              // Votar inválida/Votar válida buttons right below this.
              return <VoteBreakdown favor={no} contra={yes} pending={pending} favorLabel="Votos por validar" contraLabel="Votos por invalidar" />;
            })()}
            {isTarget ? (
              <Text style={styles.myVote}>Es tu foto — no puedes votar en esta votación.</Text>
            ) : myVote ? (
              <Text style={styles.myVote}>Ya votaste: {myVote.vote === 'yes' ? 'inválida' : 'válida'}</Text>
            ) : (
              <View style={styles.voteButtons}>
                <Button label="Votar inválida" variant="secondary" onPress={() => handleChallengeVote(challenge.id, 'yes')} />
                <Button label="Votar válida" onPress={() => handleChallengeVote(challenge.id, 'no')} />
              </View>
            )}
            {isAdmin ? (
              <View style={styles.voteButtons}>
                <Button label="Admin: invalidar ahora" variant="secondary" onPress={() => handleAdminDecide(challenge.id, false)} />
                <Button label="Admin: validar ahora" variant="secondary" onPress={() => handleAdminDecide(challenge.id, true)} />
              </View>
            ) : null}
          </Card>
        );
      })}

      {kothClaims.map((claim) => {
        const myVote = claim.votes.find((v) => v.user_id === session?.user.id) ?? null;
        const isClaimant = claim.user_id === session?.user.id;
        const yesCount = claim.votes.filter((v) => v.vote === 'yes').length;
        const noCount = claim.votes.filter((v) => v.vote === 'no').length;
        return (
          <Card key={claim.id} style={styles.proposalCard}>
            <View style={styles.proposalHeader}>
              <Text style={styles.cardTitle}>Reclamación de King of the Hill en votación</Text>
              <Badge label={`Cierra ${new Date(claim.voting_closes_at).toLocaleDateString('es-CO')}`} />
            </View>
            <Text style={styles.changeText}>
              ¿Es válido el récord de {claim.claimantName ?? 'este miembro'} en {claim.exercise?.name ?? 'este ejercicio'}?
            </Text>
            <Text style={styles.tally}>
              Marca reclamada: {formatKothValue(claim.metric_type, claim.value_canonical)}
            </Text>
            <Button label="Ver video" variant="secondary" onPress={() => setViewingKothVideoPath(claim.video_path)} />
            <Text style={styles.tally}>
              {yesCount} a favor de invalidar · {noCount} en contra · se necesitan {claim.required_votes} votos
            </Text>
            {(() => {
              const { yes, no, pending } = bucketVotes(
                members.filter((m) => VOTING_STATUSES.has(m.status) && m.user_id !== claim.user_id),
                claim.votes
              );
              // Same inversion as the photo-challenge vote above — 'yes'
              // means "vota inválida".
              return <VoteBreakdown favor={no} contra={yes} pending={pending} favorLabel="Votos por validar" contraLabel="Votos por invalidar" />;
            })()}
            {isClaimant ? (
              <Text style={styles.myVote}>Es tu reclamación — no puedes votar en esta votación.</Text>
            ) : myVote ? (
              <Text style={styles.myVote}>Ya votaste: {myVote.vote === 'yes' ? 'inválida' : 'válida'}</Text>
            ) : (
              <View style={styles.voteButtons}>
                <Button label="Votar inválida" variant="secondary" onPress={() => handleKothVote(claim.id, 'yes')} />
                <Button label="Votar válida" onPress={() => handleKothVote(claim.id, 'no')} />
              </View>
            )}
            {isAdmin ? (
              <View style={styles.voteButtons}>
                <Button
                  label="Admin: invalidar ahora"
                  variant="secondary"
                  onPress={() => handleKothAdminDecide(claim.id, false)}
                />
                <Button
                  label="Admin: validar ahora"
                  variant="secondary"
                  onPress={() => handleKothAdminDecide(claim.id, true)}
                />
              </View>
            ) : null}
          </Card>
        );
      })}

      {membership.status !== 'admin_only' ? (
        <View style={styles.actionButtons}>
          <Button label="Solicitar excusa" variant="secondary" onPress={() => router.push('/rules/excuse-request')} />
        </View>
      ) : null}

      {myActiveExcuses.length > 0 ? (
        <Card style={styles.proposalCard}>
          <Text style={styles.cardTitle}>Tus excusas</Text>
          {myActiveExcuses.map((range, i) => (
            <Text key={i} style={styles.changeText}>
              {EXCUSE_TYPE_LABELS[range.excuseType] ?? range.excuseType}: {formatExcuseRange(range)}
              {range.reason ? ` — ${range.reason}` : ''}
            </Text>
          ))}
        </Card>
      ) : null}
    </ScrollView>
    <CheckinPhotoModal
      visible={viewingPhotoPath !== null}
      photoPath={viewingPhotoPath}
      onClose={() => setViewingPhotoPath(null)}
    />
    <ZoomableImageModal
      visible={viewingExcuseProof !== null}
      imageUrl={viewingExcuseProof?.url ?? null}
      cacheKey={viewingExcuseProof?.path}
      onClose={() => setViewingExcuseProof(null)}
    />
    <KothVideoModal
      visible={viewingKothVideoPath !== null}
      videoPath={viewingKothVideoPath}
      onClose={() => setViewingKothVideoPath(null)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  cardTitle: { ...typography.heading, color: colors.text, marginBottom: spacing.sm },
  ruleRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  ruleLabel: { color: colors.textMuted },
  ruleValue: { color: colors.text, fontWeight: '600' },
  modeDescription: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: spacing.xs },
  proposalCard: { gap: spacing.sm },
  leaveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  proposalHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
  },
  changeText: { color: colors.text },
  excuseProofRow: { gap: spacing.sm },
  excuseProof: { width: 220, height: 220, borderRadius: radii.md },
  timingText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  tally: { color: colors.textMuted, fontSize: 13 },
  cycleNote: { color: colors.warning, fontSize: 13 },
  historyCycle: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyCycleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
  historyPlace: { width: 24, alignItems: 'center' },
  historyPlaceText: { color: colors.textMuted, fontWeight: '700' },
  historyName: { flex: 1, color: colors.text, fontWeight: '600' },
  historyAmount: { color: colors.text, fontWeight: '700', minWidth: 90, textAlign: 'right' },
  myVote: { color: colors.primary, fontWeight: '600' },
  voteButtons: { gap: spacing.sm, marginTop: spacing.sm },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  actionButtons: { gap: spacing.sm },
  challengePhotoRow: { flexDirection: 'row', gap: spacing.md },
});
