import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase/client';

async function getDeviceExpoPushToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return null;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  return token;
}

/**
 * Requests notification permission (creating the Android channel first, as
 * required before the permission prompt on Android 13+) and, if granted,
 * registers this device's Expo push token against the signed-in user — see
 * push_tokens (0043): a token is scoped to one device+app install, so this
 * runs on every launch and just adds/reassigns this device's row rather
 * than overwriting a single column, letting multiple devices/installs
 * (e.g. Expo Go and a TestFlight build) all receive pushes at once.
 * Best-effort — a push-registration failure should never block sign-in.
 */
export async function registerForPushNotificationsAsync(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const token = await getDeviceExpoPushToken();
    if (!token) return;

    await supabase.rpc('register_push_token', { p_token: token });
  } catch {
    // swallow — see doc comment above
  }
}

/** Best-effort: stops this specific device from receiving this user's pushes after sign-out. */
export async function unregisterCurrentDeviceToken(): Promise<void> {
  try {
    const token = await getDeviceExpoPushToken();
    if (!token) return;
    await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // best-effort — never block sign-out over this
  }
}
