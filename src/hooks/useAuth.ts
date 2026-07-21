import { useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/authStore';
import { registerForPushNotificationsAsync } from '@/lib/notifications/pushToken';
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
      registerForPushNotificationsAsync(userId);
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
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }, []);

  return {
    session,
    profile,
    isInitializing,
    isSignedIn: !!session,
    signUp,
    signIn,
    signOut,
  };
}
