import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useActiveGroupStore } from '@/state/activeGroupStore';
import { setRemindersEnabledCache } from '@/lib/notifications/reminderPreference';
import { retryOnTransientNetworkError } from '@/lib/retry';
import type { Group, GroupMember } from '@/lib/supabase/types';

/** The active group plus the signed-in user's own membership row within it. */
export function useActiveGroup() {
  const { session } = useAuth();
  const activeGroupId = useActiveGroupStore((s) => s.activeGroupId);
  const [group, setGroup] = useState<Group | null>(null);
  const [membership, setMembership] = useState<GroupMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Screens gate their whole render on isLoading, and every tab re-focus
  // calls refresh() again — without this, switching back to a tab would
  // blank the entire screen on every visit, not just the first time.
  const loadedForGroupIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeGroupId || !session) {
      setGroup(null);
      setMembership(null);
      setIsLoading(false);
      loadedForGroupIdRef.current = null;
      return;
    }
    if (loadedForGroupIdRef.current !== activeGroupId) setIsLoading(true);
    // Every screen in the app gates its ENTIRE render on isLoading — before
    // this try/finally, a network blip mid-Promise.all (a real fetch
    // rejection, not a PostgREST error response, which resolves normally
    // instead of throwing) skipped straight past setIsLoading(false)
    // forever, stranding that screen on its loading spinner with no way
    // back (reported: a full black screen right after finishing a workout
    // + checkout — several requests back to back, right when a phone's
    // connection is most likely to hiccup). retryOnTransientNetworkError
    // absorbs a brief drop silently; the finally is the backstop for
    // whatever it still can't recover from.
    try {
      const [groupRes, memberRes] = await retryOnTransientNetworkError(() =>
        Promise.all([
          supabase.from('groups').select('*').eq('id', activeGroupId).single(),
          supabase.from('group_members').select('*').eq('group_id', activeGroupId).eq('user_id', session.user.id).single(),
        ])
      );
      setGroup(groupRes.data ?? null);
      setMembership(memberRes.data ?? null);
      if (memberRes.data) await setRemindersEnabledCache(memberRes.data.notification_preferences.reminders);
    } finally {
      setIsLoading(false);
      loadedForGroupIdRef.current = activeGroupId;
    }
  }, [activeGroupId, session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { group, membership, isLoading, refresh };
}
