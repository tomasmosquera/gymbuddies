import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { ExcuseRequest, ExcuseVote } from '@/lib/supabase/types';

export interface ExcuseVoteRequest extends ExcuseRequest {
  member_name: string;
}

/** The group's currently open excuse vote (any type the admin sent to a vote), if any, plus the caller's own vote. */
export function useExcuseVote(groupId: string | null, userId: string | null) {
  const [request, setRequest] = useState<ExcuseVoteRequest | null>(null);
  const [votes, setVotes] = useState<ExcuseVote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Only the first load (or an actual group switch) should block the whole
  // screen — a useFocusEffect-triggered refresh on every tab visit shouldn't.
  const loadedForGroupIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRequest(null);
      setVotes([]);
      setIsLoading(false);
      loadedForGroupIdRef.current = null;
      return;
    }
    if (loadedForGroupIdRef.current !== groupId) setIsLoading(true);
    const { data: requestData } = await supabase
      .from('excuse_requests')
      .select('*, profile:profiles!user_id(full_name)')
      .eq('group_id', groupId)
      .eq('status', 'pending')
      .not('voting_closes_at', 'is', null)
      .maybeSingle();

    const typedRequest = requestData as unknown as (ExcuseRequest & { profile: { full_name: string } | null }) | null;
    setRequest(typedRequest ? { ...typedRequest, member_name: typedRequest.profile?.full_name ?? 'Miembro' } : null);

    if (requestData) {
      const { data: voteData } = await supabase.from('excuse_votes').select('*').eq('excuse_request_id', requestData.id);
      setVotes(voteData ?? []);
    } else {
      setVotes([]);
    }
    setIsLoading(false);
    loadedForGroupIdRef.current = groupId;
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const myVote = votes.find((v) => v.user_id === userId) ?? null;
  const yesCount = votes.filter((v) => v.vote === 'yes').length;
  const noCount = votes.filter((v) => v.vote === 'no').length;

  const castVote = useCallback(
    async (vote: 'yes' | 'no') => {
      if (!request) return;
      const { error } = await supabase.rpc('cast_excuse_vote', { p_request_id: request.id, p_vote: vote });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [request, refresh]
  );

  return { request, votes, myVote, yesCount, noCount, isLoading, refresh, castVote };
}
