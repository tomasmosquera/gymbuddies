import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_SEEN_AT_KEY = 'gymbuddies:photo-feed-last-seen-at';

/**
 * Per-device only (no DB column, no cross-device sync) — just enough state
 * to ring an unseen story item in green vs a seen one in gray, the same
 * "have I already looked at this" idea Instagram stories use. Good enough
 * for what this is: a lightweight teaser strip, not a read receipt system.
 */
export async function getPhotoFeedLastSeenAt(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SEEN_AT_KEY);
}

export async function setPhotoFeedLastSeenAt(iso: string): Promise<void> {
  await AsyncStorage.setItem(LAST_SEEN_AT_KEY, iso);
}
