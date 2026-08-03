import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { LiquidationRow } from '@/lib/supabase/types';

/**
 * The live "reparto de hoy" — what every active member would get if the
 * group were settled right now, via liquidate_group_now(p_dry_run: true).
 * Any group member can read this (it's a read-only preview); only the
 * admin can actually call liquidateNow. Same RPC/formula both times, so
 * the preview can never drift from what a real liquidation would do —
 * including surfacing the same "no hay un ciclo de Liga activo" error
 * instead of numbers when the mode needs a running cycle and there isn't one.
 */
export function useLiquidationPreview(groupId: string | null) {
  const [rows, setRows] = useState<LiquidationRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!groupId) {
      setRows([]);
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase.rpc('liquidate_group_now', { p_group_id: groupId, p_dry_run: true });
    if (error) {
      setRows([]);
      setErrorMessage(error.message);
    } else {
      setRows(data ?? []);
      setErrorMessage(null);
    }
    setIsLoading(false);
  }, [groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const liquidateNow = useCallback(async () => {
    if (!groupId) return;
    const { error } = await supabase.rpc('liquidate_group_now', { p_group_id: groupId, p_dry_run: false });
    if (error) throw new Error(error.message);
    await refresh();
  }, [groupId, refresh]);

  return { rows, errorMessage, isLoading, refresh, liquidateNow };
}
