import { Alert } from 'react-native';

/**
 * Google Play's Prominent Disclosure & Consent requirement for
 * ACCESS_BACKGROUND_LOCATION specifically — separate from the general
 * foreground one (useLocationDisclosure.ts's one-time root-layout Alert,
 * which covers check-in/check-out only). Google's own rejection reason
 * (2026-10-24): "Your app accesses the BACKGROUND_LOCATION permission
 * without a prominent disclosure" — a generic location notice shown once at
 * app open doesn't satisfy this; it has to be its own disclosure, shown
 * immediately before the real OS background-location prompt, every time
 * that's about to fire, with an explicit affirmative action (not just
 * dismissible).
 *
 * Both call sites (checkoutReminders.ts's silent post-check-in request,
 * settings.tsx's manual "Activar ubicación 'siempre'" button) gate their own
 * Location.requestBackgroundPermissionsAsync() behind this, and only even
 * call it when the OS hasn't already decided
 * (getBackgroundPermissionsAsync().status === 'undetermined') — once already
 * granted or denied, the OS itself won't show its own dialog again either
 * way, so there's nothing left to disclose.
 */
export function confirmBackgroundLocationDisclosure(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Ubicación en segundo plano',
      'Gym Buddies puede acceder a tu ubicación incluso cuando no estás usando la app, para avisarte si te alejas del gimnasio sin haber tomado tu foto de salida. Es opcional — puedes activarla ahora o más tarde desde Configuración, y desactivarla cuando quieras.',
      [
        { text: 'Ahora no', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Activar', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
