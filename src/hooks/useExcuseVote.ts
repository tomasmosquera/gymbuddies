import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { ExcuseRequest, ExcuseVote } from '@/lib/supabase/types';

/** The group's currently open "other"-type excuse vote, if any, plus the caller's own vote. */
export function useExcuseVote(groupId: string | null, userId: string | null) {
  const [request, setRequest] = useState<ExcuseRequest | null>(null);
  const [votes, setVotes] = useState<ExcuseVote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRequest(null);
      setVotes([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data: requestData } = await supabase
      .from('excuse_requests')
      .select('*')
      .eq('group_id', groupId)
      .eq('excuse_type', 'other')
      .eq('status', 'pending')
      .maybeSingle();

    setRequest(requestData ?? null);

    if (requestData) {
      const { data: voteData } = await supabase.from('excuse_votes').select('*').eq('excuse_request_id', requestData.id);
      setVotes(voteData ?? []);
    } else {
      setVotes([]);
    }
    setIsLoading(false);
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
