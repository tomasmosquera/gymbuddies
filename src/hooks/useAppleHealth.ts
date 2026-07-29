import { useCallback, useEffect, useRef } from 'react';
import { Alert, AppState, Platform, type AppStateStatus } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase/client';
import { getActiveEnergyBurnedKcal, requestAppleHealthAuthorization } from '@/lib/health/appleHealth';

const SYNC_LOOKBACK_HOURS = 72;

/**
 * Shown exactly once per user, the next time they open the app after this
 * feature ships (apple_health_prompted_at starts null for everyone).
 * Both RPCs it calls stamp apple_health_prompted_at, so neither answer
 * ("Conectar" or "Ahora no") ever shows it again.
 */
export function useAppleHealthOnboardingPrompt() {
  const { session, profile, refreshProfile } = useAuth();
  const hasPromptedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !session || !profile || hasPromptedRef.current) return;
    if (profile.apple_health_prompted_at !== null) return;
    hasPromptedRef.current = true;

    Alert.alert(
      'Conectar Apple Health',
      'Gym Buddies puede leer las calorías activas que quemaste durante tus entrenos desde Apple Health (si usas un Apple Watch u otro dispositivo conectado) y mostrarlas junto a tus check-ins.',
      [
        {
          text: 'Ahora no',
          style: 'cancel',
          onPress: async () => {
            try {
              await supabase.rpc('dismiss_apple_health_prompt');
              await refreshProfile();
            } catch {
              // best-effort — worst case the prompt shows again next open
            }
          },
        },
        {
          text: 'Conectar',
          onPress: async () => {
            try {
              await requestAppleHealthAuthorization();
              await supabase.rpc('set_apple_health_enabled', { p_enabled: true });
              await refreshProfile();
            } catch {
              // best-effort — worst case the toggle stays off and they can retry from Perfil
            }
          },
        },
      ]
    );
  }, [session, profile, refreshProfile]);
}

/**
 * iOS has no reliable "run this in exactly N minutes" background scheduling,
 * so instead of trying to time the calorie fetch precisely after checkout,
 * this retries it opportunistically: once on mount and again every time the
 * app comes back to the foreground, re-checking EVERY checkout from the
 * last 72h (not just ones still missing a value) — Health can take a while
 * to fully sync from a Watch, so an earlier attempt may have saved an
 * undercounted partial sum. set_checkin_active_energy only ever raises the
 * stored value, never lowers it, so re-querying an already-filled checkin
 * is safe: a later, more complete read corrects it upward; a same-or-lower
 * read is silently ignored server-side.
 */
export function useAppleHealthForegroundSync() {
  const { session, profile } = useAuth();
  const isSyncingRef = useRef(false);

  const syncPendingCheckouts = useCallback(async () => {
    if (Platform.OS !== 'ios' || !session || !profile?.apple_health_enabled) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      const since = new Date(Date.now() - SYNC_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
      const { data: recentCheckouts } = await supabase
        .from('checkins')
        .select('id, captured_at, checkout_captured_at')
        .eq('user_id', session.user.id)
        .not('checkout_captured_at', 'is', null)
        .gte('checkout_captured_at', since);

      for (const checkin of recentCheckouts ?? []) {
        if (!checkin.checkout_captured_at) continue;
        const kcal = await getActiveEnergyBurnedKcal(
          new Date(checkin.captured_at),
          new Date(checkin.checkout_captured_at)
        );
        if (kcal !== null) {
          await supabase.rpc('set_checkin_active_energy', { p_checkin_id: checkin.id, p_active_energy_kcal: kcal });
        }
      }
    } catch {
      // best-effort — the next foreground open just tries again
    } finally {
      isSyncingRef.current = false;
    }
  }, [session, profile?.apple_health_enabled]);

  useEffect(() => {
    syncPendingCheckouts();
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') syncPendingCheckouts();
    });
    return () => subscription.remove();
  }, [syncPendingCheckouts]);
}
