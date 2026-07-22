import { useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/authStore';
import { registerForPushNotificationsAsync, unregisterCurrentDeviceToken } from '@/lib/notifications/pushToken';
import { setRemindersEnabledCache } from '@/lib/notifications/reminderPreference';
import type { Profile } from '@/lib/supabase/types';

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) return null;
  if (data) await setRemindersEnabledCache(data.notification_preferences.reminders);
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

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isMounted) return;
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
    deleteAccount,
  };
}
