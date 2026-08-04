import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { useGroupMembers } from '@/hooks/useGroupMembers';
import { useLeagueCycle } from '@/hooks/useLeagueCycle';
import { supabase } from '@/lib/supabase/client';
import { CheckinPhotoColumn } from '@/components/checkin/CheckinPhotoColumn';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { getSignedUrl } from '@/lib/supabase/storage';
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
  exit_notice_days: 'Días de aviso para salir sin costo',
  require_checkout_photo: 'Foto final requerida',
  min_workout_minutes: 'Duración mínima del entreno (min)',
  payout_mode: 'Modo de juego',
  league_duration_months: 'Duración del ciclo de Liga (meses)',
  league_prize_splits: 'Premio por puesto',
  mixed_league_share_percent: '% del fondo para el premio de Liga',
};

const MONEY_CHANGE_FIELDS = new Set(['penalty_amount', 'weekly_penalty_cap', 'exit_fee_amount']);
const BOOLEAN_CHANGE_FIELDS = new Set(['require_checkout_photo']);
const PAYOUT_MODE_FIELDS = new Set(['payout_mode']);
const PERCENT_ARRAY_FIELDS = new Set(['league_prize_splits']);

/** Whole days remaining until `dateString` (never negative — the day it becomes effective still reads as 0, not -1). */
function daysUntil(dateString: string): number {
  const ms = new Date(dateString).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
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
  return String(value);
}

export default function RulesScreen() {
  const { session } = useAuth();
  const { group, membership, isLoading: groupLoading, refresh: refreshGroup } = useActiveGroup();
  const {
    proposal,
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
  const { members, isLoading: membersLoading, refresh: refreshMembers } = useGroupMembers(group?.id ?? null);
  const {
    cycle: leagueCycle,
    isLoading: leagueCycleLoading,
    refresh: refreshLeagueCycle,
    startCycle: startLeagueCycle,
  } = useLeagueCycle(group?.id ?? null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCancellingLeave, setIsCancellingLeave] = useState(false);
  const [isStartingCycle, setIsStartingCycle] = useState(false);
  const [viewingPhotoPath, setViewingPhotoPath] = useState<string | null>(null);
  const [excuseProofUrls, setExcuseProofUrls] = useState<string[]>([]);

  useEffect(() => {
    const paths = excuseVoteRequest?.proof_paths ?? [];
    if (paths.length === 0) {
      setExcuseProofUrls([]);
      return;
    }
    Promise.all(paths.map((p) => getSignedUrl('excuse-proofs', p)))
      .then(setExcuseProofUrls)
      .catch(() => setExcuseProofUrls([]));
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
      refreshMembers();
      refreshLeagueCycle();
    }, [refreshGroup, refreshProposal, refreshExcuseVote, refreshChallenges, refreshMembers, refreshLeagueCycle])
  );

  if (
    groupLoading ||
    proposalLoading ||
    excuseVoteLoading ||
    challengesLoading ||
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refreshGroup(),
        refreshProposal(),
        refreshExcuseVote(),
        refreshChallenges(),
        refreshMembers(),
        refreshLeagueCycle(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
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
              <Text style={styles.ruleValue}>{group.league_duration_months} mes(es)</Text>
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
      </Card>

      {group.payout_mode !== 'cooperative' ? (
        <Card style={styles.proposalCard}>
          <Text style={styles.cardTitle}>Ciclo de Liga</Text>
          {leagueCycle ? (
            <>
              <Text style={styles.changeText}>Ciclo #{leagueCycle.cycle_number} en curso</Text>
              <Text style={styles.tally}>
                Termina el {new Date(leagueCycle.ends_at).toLocaleDateString('es-CO')} (faltan{' '}
                {daysUntil(leagueCycle.ends_at)} día{daysUntil(leagueCycle.ends_at) === 1 ? '' : 's'})
              </Text>
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
            <Badge label={`Cierra ${new Date(excuseVoteRequest.voting_closes_at!).toLocaleDateString('es-CO')}`} />
          </View>
          <Text style={styles.changeText}>
            {excuseVoteRequest.member_name} · {EXCUSE_TYPE_LABELS[excuseVoteRequest.excuse_type] ?? excuseVoteRequest.excuse_type}
          </Text>
          <Text style={styles.changeText}>
            {excuseVoteRequest.requested_start_date} a {excuseVoteRequest.requested_end_date}
          </Text>
          {excuseVoteRequest.reason ? <Text style={styles.changeText}>{excuseVoteRequest.reason}</Text> : null}
          {excuseProofUrls.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.excuseProofRow}>
              {excuseProofUrls.map((url, index) => (
                <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.excuseProof} />
              ))}
            </ScrollView>
          ) : null}
          <Text style={styles.tally}>
            {excuseYesCount} a favor · {excuseNoCount} en contra · se necesitan {excuseVoteRequest.required_votes} votos
            a favor
          </Text>
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
              </View>
            ) : null}
            <Text style={styles.tally}>
              {yesCount} a favor de invalidar · {noCount} en contra · se necesitan {challenge.required_votes} votos
            </Text>
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

      <View style={styles.actionButtons}>
        <Button label="Solicitar excusa" variant="secondary" onPress={() => router.push('/rules/excuse-request')} />
      </View>
    </ScrollView>
    <CheckinPhotoModal
      visible={viewingPhotoPath !== null}
      photoPath={viewingPhotoPath}
      onClose={() => setViewingPhotoPath(null)}
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
  proposalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeText: { color: colors.text },
  excuseProofRow: { gap: spacing.sm },
  excuseProof: { width: 220, height: 220, borderRadius: radii.md },
  timingText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  tally: { color: colors.textMuted, fontSize: 13 },
  myVote: { color: colors.primary, fontWeight: '600' },
  voteButtons: { gap: spacing.sm, marginTop: spacing.sm },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  actionButtons: { gap: spacing.sm },
  challengePhotoRow: { flexDirection: 'row', width: '50%' },
});
