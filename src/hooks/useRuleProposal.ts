import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { RuleProposal, RuleVote } from '@/lib/supabase/types';

/**
 * The group's currently open (pending) rule-change vote, if any, plus the
 * caller's own vote — and separately, a proposal that already WON the vote
 * but hasn't taken effect yet (run_weekly_evaluation only applies it on the
 * Monday on/after its effective_at, per the "grade the current week under
 * the old rules first" product rule). Without surfacing that second state,
 * an approved change just silently vanishes from the UI until the following
 * Monday, which reads as "my vote didn't do anything."
 */
export function useRuleProposal(groupId: string | null, userId: string | null) {
  const [proposal, setProposal] = useState<RuleProposal | null>(null);
  const [votes, setVotes] = useState<RuleVote[]>([]);
  const [upcomingChange, setUpcomingChange] = useState<RuleProposal | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setProposal(null);
      setVotes([]);
      setUpcomingChange(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const [{ data: proposalData }, { data: upcomingData }] = await Promise.all([
      supabase.from('rule_proposals').select('*').eq('group_id', groupId).eq('status', 'pending').maybeSingle(),
      supabase
        .from('rule_proposals')
        .select('*')
        .eq('group_id', groupId)
        .eq('status', 'approved')
        .is('applied_at', null)
        .order('effective_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    setProposal(proposalData ?? null);
    setUpcomingChange(upcomingData ?? null);

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

  return { proposal, votes, myVote, yesCount, noCount, upcomingChange, isLoading, refresh, castVote };
}
