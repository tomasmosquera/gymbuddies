import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase/client';

/**
 * Google Play's Prominent Disclosure & Consent requirement: a sensitive
 * permission like location has to be explained in-app — what's collected,
 * why — BEFORE the OS permission dialog ever fires; the dialog's own
 * description text doesn't satisfy this on its own. Shown exactly once per
 * user, the next time they open the app after this ships
 * (location_disclosure_acknowledged_at starts null for everyone), mounted at
 * the root layout so it's guaranteed to resolve before checkin/index.tsx's
 * own useLocationLock — or settings.tsx's manual "Activar ubicación"
 * buttons, or admin-members.tsx's lock — ever gets a chance to request the
 * real permission. Same one-time-Alert shape as useAppleHealthOnboardingPrompt.
 */
export function useLocationDisclosurePrompt() {
  const { session, profile, refreshProfile } = useAuth();
  const hasPromptedRef = useRef(false);

  useEffect(() => {
    if (!session || !profile || hasPromptedRef.current) return;
    if (profile.location_disclosure_acknowledged_at !== null) return;
    hasPromptedRef.current = true;

    Alert.alert(
      'Ubicación en Gym Buddies',
      'Gym Buddies usa la ubicación de tu teléfono para verificar que tu check-in y tu check-out se hicieron en el gimnasio. También puede usarla en segundo plano (opcional, lo puedes desactivar en Configuración) para avisarte si llegaste al gimnasio o si te fuiste sin tomar tu foto de salida.\n\nAhora te lo va a pedir el sistema operativo.',
      [
        {
          text: 'Entendido',
          onPress: async () => {
            try {
              await supabase.rpc('acknowledge_location_disclosure');
              await refreshProfile();
            } catch {
              // best-effort — worst case the prompt shows again next open
            }
          },
        },
      ]
    );
  }, [session, profile, refreshProfile]);
}
