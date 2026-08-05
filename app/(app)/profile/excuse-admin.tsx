import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroup } from '@/hooks/useActiveGroup';
import { useExcuseVote, type ExcuseVoteRequest } from '@/hooks/useExcuseVote';
import { supabase } from '@/lib/supabase/client';
import { getSignedUrl } from '@/lib/supabase/storage';
import { ZoomableImageModal } from '@/components/ui/ZoomableImageModal';
import type { ExcuseRequest } from '@/lib/supabase/types';
import { colors, radii, spacing, typography } from '@/constants/theme';

interface PendingRequest extends ExcuseRequest {
  member_name: string;
}

interface ResolvedRequest extends ExcuseRequest {
  member_name: string;
  yesVotes: number;
  noVotes: number;
  voters: { fullName: string; vote: 'yes' | 'no' }[];
}

const TYPE_LABELS: Record<'travel' | 'medical' | 'other', string> = {
  travel: 'Viaje',
  medical: 'Médica',
  other: 'Otro motivo',
};

/** Every calendar date string between start and end, inclusive. */
function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function PendingRequestRow({ request, onDecided }: { request: PendingRequest; onDecided: () => void }) {
  const [proofItems, setProofItems] = useState<{ url: string; path: string }[]>([]);
  const [viewingProof, setViewingProof] = useState<{ url: string; path: string } | null>(null);
  const allDates = datesInRange(request.requested_start_date, request.requested_end_date);
  const [selectedDates, setSelectedDates] = useState<string[]>(allDates);
  const [isDeciding, setIsDeciding] = useState(false);

  useEffect(() => {
    if (request.proof_paths.length > 0) {
      Promise.all(request.proof_paths.map((p) => getSignedUrl('excuse-proofs', p).then((url) => ({ url, path: p }))))
        .then(setProofItems)
        .catch(() => setProofItems([]));
    }
  }, [request.proof_paths]);

  const toggleDate = (date: string) => {
    setSelectedDates((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));
  };

  const approve = async () => {
    if (selectedDates.length === 0) {
      Alert.alert('Selecciona al menos un día', 'Elige qué días de la solicitud quedan excusados.');
      return;
    }
    setIsDeciding(true);
    try {
      const { error } = await supabase.rpc('approve_excuse_request', {
        p_request_id: request.id,
        p_excused_dates: selectedDates,
      });
      if (error) throw new Error(error.message);
      onDecided();
    } catch (err) {
      Alert.alert('No se pudo aprobar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeciding(false);
    }
  };

  const reject = async () => {
    setIsDeciding(true);
    try {
      const { error } = await supabase.rpc('reject_excuse_request', { p_request_id: request.id });
      if (error) throw new Error(error.message);
      onDecided();
    } catch (err) {
      Alert.alert('No se pudo rechazar', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeciding(false);
    }
  };

  const confirmSendToVote = () => {
    Alert.alert(
      'Enviar a votación',
      `Todo el grupo votará si la excusa de ${request.member_name} se aprueba. Si gana el "sí", se excusa todo el rango solicitado (${request.requested_start_date} a ${request.requested_end_date}).`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Enviar a votación', onPress: sendToVote },
      ]
    );
  };

  const sendToVote = async () => {
    setIsDeciding(true);
    try {
      const { error } = await supabase.rpc('send_excuse_request_to_vote', { p_request_id: request.id });
      if (error) throw new Error(error.message);
      onDecided();
    } catch (err) {
      Alert.alert('No se pudo enviar a votación', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsDeciding(false);
    }
  };

  return (
    <Card style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{request.member_name}</Text>
        <Badge label={TYPE_LABELS[request.excuse_type as 'travel' | 'medical' | 'other']} />
      </View>
      <Text style={styles.rowSubtitle}>
        {request.requested_start_date} a {request.requested_end_date}
      </Text>
      {request.reason ? <Text style={styles.reason}>{request.reason}</Text> : null}
      {proofItems.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.proofRow}>
          {proofItems.map((item) => (
            <Pressable key={item.path} onPress={() => setViewingProof(item)}>
              <Image
                source={{ uri: item.url, cacheKey: item.path }}
                style={styles.proof}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ZoomableImageModal
        visible={viewingProof !== null}
        imageUrl={viewingProof?.url ?? null}
        cacheKey={viewingProof?.path}
        onClose={() => setViewingProof(null)}
      />

      <Text style={styles.datesLabel}>Días a excusar:</Text>
      <View style={styles.datesList}>
        {allDates.map((date) => {
          const isSelected = selectedDates.includes(date);
          return (
            <Pressable
              key={date}
              onPress={() => toggleDate(date)}
              style={[styles.dateChip, isSelected && styles.dateChipSelected]}
            >
              <Text style={[styles.dateChipText, isSelected && styles.dateChipTextSelected]}>{date}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Button label="Aprobar" onPress={approve} loading={isDeciding} />
        <Button label="Rechazar" variant="danger" onPress={reject} loading={isDeciding} />
      </View>
      <Button label="Enviar a votación del grupo" variant="secondary" onPress={confirmSendToVote} loading={isDeciding} />
    </Card>
  );
}

/**
 * The group's single open excuse vote (at most one at a time — see
 * one_open_excuse_vote_per_group). Distinct from PendingRequestRow: once a
 * request is sent to a vote, approve/reject_excuse_request refuse to decide
 * it directly anymore — the only admin action left is casting/changing their
 * own vote here, same as any other member does from the Rules tab.
 */
function VotingRequestCard({
  request,
  yesCount,
  noCount,
  myVote,
  isVoting,
  onVote,
}: {
  request: ExcuseVoteRequest;
  yesCount: number;
  noCount: number;
  myVote: 'yes' | 'no' | null;
  isVoting: boolean;
  onVote: (vote: 'yes' | 'no') => void;
}) {
  const [proofItems, setProofItems] = useState<{ url: string; path: string }[]>([]);
  const [viewingProof, setViewingProof] = useState<{ url: string; path: string } | null>(null);

  useEffect(() => {
    if (request.proof_paths.length > 0) {
      Promise.all(request.proof_paths.map((p) => getSignedUrl('excuse-proofs', p).then((url) => ({ url, path: p }))))
        .then(setProofItems)
        .catch(() => setProofItems([]));
    } else {
      setProofItems([]);
    }
  }, [request.proof_paths]);

  return (
    <Card style={styles.votingCard}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{request.member_name}</Text>
        <Badge label={TYPE_LABELS[request.excuse_type as 'travel' | 'medical' | 'other']} />
      </View>
      <Text style={styles.rowSubtitle}>
        {request.requested_start_date} a {request.requested_end_date}
      </Text>
      {request.reason ? <Text style={styles.reason}>{request.reason}</Text> : null}
      {proofItems.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.proofRow}>
          {proofItems.map((item) => (
            <Pressable key={item.path} onPress={() => setViewingProof(item)}>
              <Image
                source={{ uri: item.url, cacheKey: item.path }}
                style={styles.proof}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ZoomableImageModal
        visible={viewingProof !== null}
        imageUrl={viewingProof?.url ?? null}
        cacheKey={viewingProof?.path}
        onClose={() => setViewingProof(null)}
      />

      <View style={styles.voteTallyRow}>
        <Text style={styles.voteTally}>
          {yesCount} a favor · {noCount} en contra · se necesitan {request.required_votes} votos a favor
        </Text>
        {request.voting_closes_at ? (
          <Badge label={`Cierra ${new Date(request.voting_closes_at).toLocaleDateString('es-CO')}`} tone="warning" />
        ) : null}
      </View>
      <Text style={styles.voteHint}>
        {myVote ? `Tu voto actual: ${myVote === 'yes' ? 'a favor' : 'en contra'} — puedes cambiarlo.` : 'Todavía no has votado.'}
      </Text>
      <View style={styles.actions}>
        <Button label="Votar a favor" onPress={() => onVote('yes')} loading={isVoting} disabled={myVote === 'yes'} />
        <Button
          label="Votar en contra"
          variant="secondary"
          onPress={() => onVote('no')}
          loading={isVoting}
          disabled={myVote === 'no'}
        />
      </View>
    </Card>
  );
}

function ResolvedRequestRow({ request }: { request: ResolvedRequest }) {
  const wasApproved = request.status === 'approved';
  const wasVoted = request.voting_closes_at !== null;
  const [isExpanded, setIsExpanded] = useState(false);
  const yesVoters = request.voters.filter((v) => v.vote === 'yes');
  const noVoters = request.voters.filter((v) => v.vote === 'no');

  const content = (
    <>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{request.member_name}</Text>
        <Badge label={wasApproved ? 'Aprobada' : 'Rechazada'} tone={wasApproved ? 'success' : 'danger'} />
      </View>
      <Text style={styles.rowSubtitle}>
        {TYPE_LABELS[request.excuse_type as 'travel' | 'medical' | 'other']} · {request.requested_start_date} a{' '}
        {request.requested_end_date}
      </Text>
      <Text style={styles.resolvedHint}>
        {wasVoted
          ? `Decidido por votación del grupo: ${request.yesVotes} a favor · ${request.noVotes} en contra — toca para ver quién votó`
          : request.decided_by
            ? 'Decidido directamente por el admin'
            : 'Cerrado automáticamente'}
      </Text>
      {isExpanded && wasVoted ? (
        <View style={styles.votersBlock}>
          <View style={styles.votersColumn}>
            <Text style={styles.votersColumnTitle}>A favor ({yesVoters.length})</Text>
            {yesVoters.length > 0 ? (
              yesVoters.map((v, i) => (
                <Text key={i} style={styles.voterName}>
                  {v.fullName}
                </Text>
              ))
            ) : (
              <Text style={styles.voterNameEmpty}>Nadie</Text>
            )}
          </View>
          <View style={styles.votersColumn}>
            <Text style={styles.votersColumnTitle}>En contra ({noVoters.length})</Text>
            {noVoters.length > 0 ? (
              noVoters.map((v, i) => (
                <Text key={i} style={styles.voterName}>
                  {v.fullName}
                </Text>
              ))
            ) : (
              <Text style={styles.voterNameEmpty}>Nadie</Text>
            )}
          </View>
        </View>
      ) : null}
    </>
  );

  if (!wasVoted) {
    return <Card style={styles.resolvedRow}>{content}</Card>;
  }

  return (
    <Pressable onPress={() => setIsExpanded((e) => !e)}>
      <Card style={styles.resolvedRow}>{content}</Card>
    </Pressable>
  );
}

export default function ExcuseAdminScreen() {
  const { session } = useAuth();
  const { group, isLoading: groupLoading } = useActiveGroup();
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [resolvedRequests, setResolvedRequests] = useState<ResolvedRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const {
    request: voteRequest,
    yesCount: voteYesCount,
    noCount: voteNoCount,
    myVote,
    isLoading: voteLoading,
    refresh: refreshVote,
    castVote,
  } = useExcuseVote(group?.id ?? null, session?.user.id ?? null);
  const [isVoting, setIsVoting] = useState(false);

  const handleVote = async (vote: 'yes' | 'no') => {
    setIsVoting(true);
    try {
      await castVote(vote);
    } catch (err) {
      Alert.alert('No se pudo registrar tu voto', err instanceof Error ? err.message : 'Intenta de nuevo');
    } finally {
      setIsVoting(false);
    }
  };

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!group) return;
      if (opts?.silent) setIsRefreshing(true);
      else setIsLoading(true);

      const [pendingRes, resolvedRes] = await Promise.all([
        supabase
          .from('excuse_requests')
          .select('*, profile:profiles!user_id(full_name)')
          .eq('group_id', group.id)
          .eq('status', 'pending')
          .is('voting_closes_at', null)
          .order('created_at', { ascending: true }),
        supabase
          .from('excuse_requests')
          .select('*, profile:profiles!user_id(full_name)')
          .eq('group_id', group.id)
          .in('status', ['approved', 'rejected'])
          .order('decided_at', { ascending: false }),
      ]);

      if (pendingRes.error) {
        Alert.alert('No se pudieron cargar las excusas', pendingRes.error.message);
      } else if (pendingRes.data) {
        setRequests(
          (pendingRes.data as unknown as (ExcuseRequest & { profile: { full_name: string } | null })[]).map((r) => ({
            ...r,
            member_name: r.profile?.full_name ?? 'Miembro',
          }))
        );
      }

      if (resolvedRes.data) {
        const resolved = resolvedRes.data as unknown as (ExcuseRequest & { profile: { full_name: string } | null })[];
        const votedIds = resolved.filter((r) => r.voting_closes_at !== null).map((r) => r.id);
        const votersByRequest = new Map<string, { fullName: string; vote: 'yes' | 'no' }[]>();
        if (votedIds.length > 0) {
          const { data: votesData } = await supabase
            .from('excuse_votes')
            .select('excuse_request_id, vote, profile:profiles!user_id(full_name)')
            .in('excuse_request_id', votedIds);
          for (const v of (votesData ?? []) as unknown as {
            excuse_request_id: string;
            vote: 'yes' | 'no';
            profile: { full_name: string } | null;
          }[]) {
            if (!votersByRequest.has(v.excuse_request_id)) votersByRequest.set(v.excuse_request_id, []);
            votersByRequest.get(v.excuse_request_id)!.push({ fullName: v.profile?.full_name ?? 'Miembro', vote: v.vote });
          }
        }
        setResolvedRequests(
          resolved.map((r) => {
            const voters = votersByRequest.get(r.id) ?? [];
            return {
              ...r,
              member_name: r.profile?.full_name ?? 'Miembro',
              yesVotes: voters.filter((v) => v.vote === 'yes').length,
              noVotes: voters.filter((v) => v.vote === 'no').length,
              voters,
            };
          })
        );
      }

      setIsLoading(false);
      setIsRefreshing(false);
    },
    [group]
  );

  // Refetches every time this screen gains focus — otherwise a new excuse
  // request submitted while the admin already had this screen open earlier
  // in the stack never appears without a pull-to-refresh or app restart.
  useFocusEffect(
    useCallback(() => {
      refresh({ silent: true });
      refreshVote();
    }, [refresh, refreshVote])
  );

  if (groupLoading || isLoading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      data={requests}
      keyExtractor={(item) => item.id}
      onRefresh={() => {
        refresh({ silent: true });
        refreshVote();
      }}
      refreshing={isRefreshing}
      ListHeaderComponent={
        voteRequest ? (
          <View style={styles.votingSection}>
            <Text style={styles.historyTitle}>Votación de excusa en curso</Text>
            <VotingRequestCard
              request={voteRequest}
              yesCount={voteYesCount}
              noCount={voteNoCount}
              myVote={myVote?.vote ?? null}
              isVoting={isVoting || voteLoading}
              onVote={handleVote}
            />
            {requests.length > 0 ? <Text style={styles.historyTitle}>Pendientes por decidir</Text> : null}
          </View>
        ) : null
      }
      ListEmptyComponent={
        voteRequest ? null : <EmptyState title="Sin pendientes" description="No hay excusas por revisar." />
      }
      renderItem={({ item }) => <PendingRequestRow request={item} onDecided={() => refresh({ silent: true })} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      ListFooterComponent={
        resolvedRequests.length > 0 ? (
          <View style={styles.historySection}>
            <Text style={styles.historyTitle}>Historial de excusas resueltas</Text>
            {resolvedRequests.map((r) => (
              <ResolvedRequestRow key={r.id} request={r} />
            ))}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { padding: spacing.lg, backgroundColor: colors.background, flexGrow: 1 },
  row: { gap: spacing.sm },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  rowSubtitle: { color: colors.textMuted },
  reason: { color: colors.text },
  proofRow: { gap: spacing.sm },
  proof: { width: 220, height: 220, borderRadius: radii.md },
  datesLabel: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  datesList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  dateChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  dateChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateChipText: { color: colors.textMuted, fontSize: 12 },
  dateChipTextSelected: { color: colors.primaryText, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  votingSection: { gap: spacing.sm, marginBottom: spacing.lg },
  votingCard: { gap: spacing.sm },
  voteTallyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  voteTally: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  voteHint: { color: colors.text, fontSize: 13, fontWeight: '600' },
  historySection: { marginTop: spacing.lg, gap: spacing.sm },
  historyTitle: { ...typography.heading, fontSize: 18, color: colors.text, marginBottom: spacing.xs },
  resolvedRow: { gap: spacing.xs },
  resolvedHint: { color: colors.textMuted, fontSize: 12 },
  votersBlock: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  votersColumn: { flex: 1, gap: 2 },
  votersColumnTitle: { color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 2 },
  voterName: { color: colors.textMuted, fontSize: 13 },
  voterNameEmpty: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
});
