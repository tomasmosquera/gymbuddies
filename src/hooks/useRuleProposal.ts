import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { RuleProposal, RuleVote } from '@/lib/supabase/types';

/** The group's currently open (pending) rule-change vote, if any, plus the caller's own vote. */
export function useRuleProposal(groupId: string | null, userId: string | null) {
  const [proposal, setProposal] = useState<RuleProposal | null>(null);
  const [votes, setVotes] = useState<RuleVote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setProposal(null);
      setVotes([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data: proposalData } = await supabase
      .from('rule_proposals')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'pending')
      .maybeSingle();

    setProposal(proposalData ?? null);

    if (proposalData) {
      const { data: voteData } = await supabase.from('rule_votes').select('*').eq('proposal_id', proposalData.id);
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
      if (!proposal) return;
      const { error } = await supabase.rpc('cast_vote', { p_proposal_id: proposal.id, p_vote: vote });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [proposal, refresh]
  );

  return { proposal, votes, myVote, yesCount, noCount, isLoading, refresh, castVote };
}
