import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { CheckinPhotoColumn } from '@/components/checkin/CheckinPhotoColumn';
import { CheckinPhotoModal } from '@/components/checkin/CheckinPhotoModal';
import { colors, spacing, typography } from '@/constants/theme';

const CHANGE_LABELS: Record<string, string> = {
  min_days_per_week: 'Días mínimos por semana',
  penalty_amount: 'Penalización por día fallado',
  weekly_penalty_cap: 'Tope de multa por semana',
  exit_fee_amount: 'Cuota por salir sin aviso',
  exit_notice_days: 'Días de aviso para salir sin costo',
  require_checkout_photo: 'Foto final requerida',
  min_workout_minutes: 'Duración mínima del entreno (min)',
};

const MONEY_CHANGE_FIELDS = new Set(['penalty_amount', 'weekly_penalty_cap', 'exit_fee_amount']);
const BOOLEAN_CHANGE_FIELDS = new Set(['require_checkout_photo']);

function formatChangeValue(key: string, value: unknown): string {
  if (BOOLEAN_CHANGE_FIELDS.has(key)) {
    return value ? 'Sí' : 'No';
  }
  if (MONEY_CHANGE_FIELDS.has(key) && typeof value === 'number') {
    return value.toLocaleString('es-CO');
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewingPhotoPath, setViewingPhotoPath] = useState<string | null>(null);

  // This tab stays mounted across switches — without refetching on focus,
  // a proposal/excuse/photo vote resolved or cast elsewhere would keep
  // showing stale state here until a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      refreshGroup();
      refreshProposal();
      refreshExcuseVote();
      refreshChallenges();
    }, [refreshGroup, refreshProposal, refreshExcuseVote, refreshChallenges])
  );

  if (groupLoading || proposalLoading || excuseVoteLoading || challengesLoading || !group || !membership) {
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
      await Promise.all([refreshGroup(), refreshProposal(), refreshExcuseVote(), refreshChallenges()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <>
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
    >
      <Card>
        <Text style={styles.cardTitle}>Reglas actuales</Text>
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
      </Card>

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
            {excuseVoteRequest.requested_start_date} a {excuseVoteRequest.requested_end_date}
          </Text>
          {excuseVoteRequest.reason ? <Text style={styles.changeText}>{excuseVoteRequest.reason}</Text> : null}
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
        {isAdmin ? (
          <Button label="Revisar excusas" variant="secondary" onPress={() => router.push('/rules/excuse-admin')} />
        ) : null}
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
  proposalCard: { gap: spacing.sm },
  proposalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeText: { color: colors.text },
  timingText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  tally: { color: colors.textMuted, fontSize: 13 },
  myVote: { color: colors.primary, fontWeight: '600' },
  voteButtons: { gap: spacing.sm, marginTop: spacing.sm },
  emptyText: { color: colors.textMuted, textAlign: 'center' },
  actionButtons: { gap: spacing.sm },
  challengePhotoRow: { flexDirection: 'row', width: '50%' },
});
