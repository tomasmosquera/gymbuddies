import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'gymbuddies:reminders-enabled';

/**
 * Cached mirror of profile.notification_preferences.reminders, readable from
 * places that can't reach React state or Supabase synchronously — the
 * background geofence task in particular, which runs as a standalone
 * TaskManager callback with no access to the app's component tree. Kept in
 * sync by useAuth's bootstrap effect and the Permisos screen. Defaults to
 * enabled if never written, matching the column's DB default.
 */
export async function setRemindersEnabledCache(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}

export async function getRemindersEnabledCache(): Promise<boolean> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  return value !== '0';
}
