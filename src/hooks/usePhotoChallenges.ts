import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { PhotoChallenge, PhotoChallengeVote } from '@/lib/supabase/types';
import type { GroupCheckinWithProfile } from './useGroupWeekCheckins';

export interface PhotoChallengeWithVotes extends PhotoChallenge {
  votes: PhotoChallengeVote[];
  checkin: GroupCheckinWithProfile | null;
  challengerName: string | null;
}

/** Every open (pending) photo challenge in a group, each with its own votes. */
export function usePhotoChallenges(groupId: string | null) {
  const [challenges, setChallenges] = useState<PhotoChallengeWithVotes[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setChallenges([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data: challengeData } = await supabase
      .from('photo_challenges')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    const ids = (challengeData ?? []).map((c) => c.id);
    const checkinIds = (challengeData ?? []).map((c) => c.checkin_id);
    const challengerIds = (challengeData ?? []).map((c) => c.challenged_by);
    const [{ data: voteData }, { data: checkinData }, { data: challengerData }] = await Promise.all([
      ids.length > 0
        ? supabase.from('photo_challenge_votes').select('*').in('challenge_id', ids)
        : Promise.resolve({ data: [] }),
      checkinIds.length > 0
        ? supabase.from('checkins').select('*, profile:profiles(full_name)').in('id', checkinIds)
        : Promise.resolve({ data: [] }),
      challengerIds.length > 0
        ? supabase.from('profiles').select('id, full_name').in('id', challengerIds)
        : Promise.resolve({ data: [] }),
    ]);

    const withVotes = (challengeData ?? []).map((c) => ({
      ...c,
      votes: (voteData ?? []).filter((v) => v.challenge_id === c.id),
      checkin: ((checkinData ?? []) as unknown as GroupCheckinWithProfile[]).find((k) => k.id === c.checkin_id) ?? null,
      challengerName: (challengerData ?? []).find((p) => p.id === c.challenged_by)?.full_name ?? null,
    }));
    setChallenges(withVotes);
    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createChallenge = useCallback(
    async (checkinId: string, reason: string) => {
      const { error } = await supabase.rpc('create_photo_challenge', {
        p_checkin_id: checkinId,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  const castVote = useCallback(
    async (challengeId: string, vote: 'yes' | 'no') => {
      const { error } = await supabase.rpc('cast_photo_challenge_vote', {
        p_challenge_id: challengeId,
        p_vote: vote,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  const adminDecide = useCallback(
    async (challengeId: string, valid: boolean) => {
      const { error } = await supabase.rpc('admin_decide_photo_challenge', {
        p_challenge_id: challengeId,
        p_valid: valid,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [refresh]
  );

  return { challenges, isLoading, refresh, createChallenge, castVote, adminDecide };
}
