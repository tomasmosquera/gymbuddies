import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { ExcuseRequest, ExcuseType } from '@/lib/supabase/types';

/** The caller's own excuse requests (any status) within one group, newest first. */
export function useExcuseRequests(groupId: string | null, userId: string | null) {
  const [requests, setRequests] = useState<ExcuseRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId || !userId) {
      setRequests([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('excuse_requests')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) setRequests(data);
    setIsLoading(false);
  }, [groupId, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createExcuseRequest = useCallback(
    async (
      excuseType: ExcuseType,
      startDate: string,
      endDate: string,
      reason?: string,
      proofPath?: string
    ) => {
      if (!groupId) return;
      const { error } = await supabase.rpc('create_excuse_request', {
        p_group_id: groupId,
        p_excuse_type: excuseType,
        p_start_date: startDate,
        p_end_date: endDate,
        p_reason: reason ?? null,
        p_proof_path: proofPath ?? null,
      });
      if (error) throw new Error(error.message);
      await refresh();
    },
    [groupId, refresh]
  );

  return { requests, isLoading, refresh, createExcuseRequest };
}
