import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase/client';

/**
 * Requests notification permission (creating the Android channel first, as
 * required before the permission prompt on Android 13+) and, if granted,
 * saves the device's Expo push token onto the user's profile. Best-effort —
 * a push-registration failure should never block sign-in.
 */
export async function registerForPushNotificationsAsync(userId: string): Promise<void> {
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

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
  } catch {
    // swallow — see doc comment above
  }
}
