import { useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/authStore';
import { registerForPushNotificationsAsync, unregisterCurrentDeviceToken } from '@/lib/notifications/pushToken';
import { stopArrivalGeofence } from '@/lib/notifications/checkinArrivalReminders';
import type { Profile } from '@/lib/supabase/types';

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) return null;
  return data;
}

/**
 * Bootstraps the Supabase auth session once at the app root and keeps
 * authStore in sync with sign-in/sign-out/token-refresh events. Mount this
 * exactly once, in app/_layout.tsx.
 */
export function useAuthBootstrap() {
  const setSession = useAuthStore((s) => s.setSession);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setInitializing = useAuthStore((s) => s.setInitializing);
  const userId = useAuthStore((s) => s.session?.user.id);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      setSession(session);
      setProfile(session ? await fetchProfile(session.user.id) : null);
      setInitializing(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      // A fresh interactive sign-in only — never on cold-start session
      // restore (that's getSession() above, not this listener) or a token
      // refresh. app/index.tsx reacts to the session becoming truthy with
      // an immediate <Redirect>, which tears the sign-in screen (and its
      // textContentType-tagged credential fields) out of the view hierarchy
      // within milliseconds — too fast for iOS's "Save Password?" prompt to
      // ever get a chance to attach to the still-visible fields. This delay
      // is the standard workaround: it buys iOS's Keychain heuristic the
      // brief window it needs before the screen disappears.
      if (event === 'SIGNED_IN') {
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (!isMounted) return;
      }
      setSession(session);
      setProfile(session ? await fetchProfile(session.user.id) : null);
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [setSession, setProfile, setInitializing]);

  useEffect(() => {
    if (userId) {
      registerForPushNotificationsAsync();
    }
  }, [userId]);
}

export function useAuth() {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const setProfile = useAuthStore((s) => s.setProfile);

  const signUp = useCallback(async (email: string, password: string, fullName: string, phone?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone: phone || null } },
    });
    if (error) throw new Error(error.message);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await unregisterCurrentDeviceToken();
    // Unlike the checkout reminder (which lasts a few hours and cancels
    // itself), the arrival geofence runs indefinitely in the background —
    // has to be stopped explicitly or it'd keep watching for a signed-out
    // account.
    await stopArrivalGeofence().catch(() => {});
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }, []);

  // Supabase's updateUser doesn't require the current password since the
  // session itself already proves identity — re-verifying it here anyway
  // matches what users expect and stops a few seconds of unlocked-phone
  // access from locking the real owner out.
  const updatePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const email = session?.user.email;
      if (!email) throw new Error('No hay sesión activa');
      const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (reauthError) throw new Error('La contraseña actual no es correcta');
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
    },
    [session]
  );

  const updateProfile = useCallback(
    async (fullName: string, phone: string | null) => {
      if (!session) throw new Error('No hay sesión activa');
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: fullName, phone })
        .eq('id', session.user.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      setProfile(data);
    },
    [session, setProfile]
  );

  /** Re-fetches the current user's profile row — call after an RPC that mutates it server-side (e.g. set_apple_health_enabled) so the in-memory copy doesn't go stale. */
  const refreshProfile = useCallback(async () => {
    if (!session) return;
    setProfile(await fetchProfile(session.user.id));
  }, [session, setProfile]);

  const deleteAccount = useCallback(
    async (currentPassword: string) => {
      const email = session?.user.email;
      if (!email) throw new Error('No hay sesión activa');
      const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (reauthError) throw new Error('La contraseña actual no es correcta');
      const { error } = await supabase.rpc('delete_own_account');
      if (error) throw new Error(error.message);
      await supabase.auth.signOut();
    },
    [session]
  );

  return {
    session,
    profile,
    isInitializing,
    isSignedIn: !!session,
    signUp,
    signIn,
    signOut,
    updatePassword,
    updateProfile,
    refreshProfile,
    deleteAccount,
  };
}
