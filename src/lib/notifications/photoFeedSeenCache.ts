import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_IDS_KEY = 'gymbuddies:photo-feed-seen-checkin-ids';

// A plain cap rather than a time-based prune — simplest way to keep this
// from growing forever, and generous enough that a check-in falls out of
// the feed query entirely (expired media, or just aged past `limit`) long
// before it'd ever get pushed out of this list.
const MAX_SEEN_IDS = 300;

/**
 * Per-device only (no DB column, no cross-device sync), and per CHECK-IN,
 * not per "have I opened the feed at all" — a member who taps one story and
 * never opens another should see that one ring go gray while every other
 * unopened one stays green. Good enough for what this is: a lightweight
 * teaser strip, not a read receipt system.
 */
export async function getSeenCheckinIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(SEEN_IDS_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function markCheckinSeen(checkinId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(SEEN_IDS_KEY);
  let ids: string[] = [];
  if (raw) {
    try {
      ids = JSON.parse(raw) as string[];
    } catch {
      ids = [];
    }
  }
  ids = ids.filter((id) => id !== checkinId);
  ids.push(checkinId);
  if (ids.length > MAX_SEEN_IDS) ids = ids.slice(ids.length - MAX_SEEN_IDS);
  await AsyncStorage.setItem(SEEN_IDS_KEY, JSON.stringify(ids));
}
