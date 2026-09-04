import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_CHECKIN_DATE_KEY = 'gymbuddies:arrival-last-checkin-date';
const LAST_REMINDER_DATE_KEY = 'gymbuddies:arrival-last-reminder-date';

/**
 * AsyncStorage mirrors for the arrival-geofence background task (see
 * checkinArrivalGeofenceTask.ts), same reasoning as reminderPreference.ts:
 * a standalone TaskManager callback has no access to React state or an
 * authenticated Supabase client, so it can only trust what was last written
 * here by a live screen (Home, or right after submit_checkin).
 */

export async function setLastCheckinDateCache(date: string): Promise<void> {
  await AsyncStorage.setItem(LAST_CHECKIN_DATE_KEY, date);
}

export async function getLastCheckinDateCache(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_CHECKIN_DATE_KEY);
}

export async function setLastArrivalReminderDateCache(date: string): Promise<void> {
  await AsyncStorage.setItem(LAST_REMINDER_DATE_KEY, date);
}

export async function getLastArrivalReminderDateCache(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_REMINDER_DATE_KEY);
}
