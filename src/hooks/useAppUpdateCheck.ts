import { useEffect, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { supabase } from '@/lib/supabase/client';
import { isVersionOlderThan } from '@/lib/domain/version';

/**
 * Compares this install's own runtimeVersion (frozen into the native binary
 * at build time — an OTA update can never change it, since expo-updates
 * only ever delivers updates published under a matching runtime version) to
 * "latest_version" for this platform in app_version_info. Only nags when
 * this install is genuinely OLDER (isVersionOlderThan, not just "different")
 * — a build already newer than the seeded "latest" (e.g. a TestFlight
 * tester ahead of the public App Store release) or a stale/out-of-sync
 * "latest" value must never trigger a false "please update". Dismissible,
 * not blocking — shows once per app open (component state, deliberately not
 * persisted) rather than nagging on every foreground.
 */
export function useAppUpdateCheck() {
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (hasChecked) return;
    const currentVersion = Updates.runtimeVersion;
    const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
    if (!currentVersion || !platform) {
      setHasChecked(true);
      return;
    }

    (async () => {
      try {
        const { data } = await supabase
          .from('app_version_info')
          .select('latest_version, store_url, message')
          .eq('platform', platform)
          .maybeSingle();
        setHasChecked(true);
        if (!data || !isVersionOlderThan(currentVersion, data.latest_version)) return;
        Alert.alert(
          'Nueva versión disponible',
          data.message ?? 'Hay una nueva versión de Gym Buddies disponible. Te recomendamos actualizar para evitar errores.',
          [
            { text: 'Ahora no', style: 'cancel' },
            {
              text: 'Actualizar',
              onPress: () => {
                if (data.store_url) Linking.openURL(data.store_url).catch(() => {});
              },
            },
          ]
        );
      } catch {
        setHasChecked(true);
      }
    })();
  }, [hasChecked]);
}
