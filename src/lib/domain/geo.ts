const EARTH_RADIUS_METERS = 6371000;

/** Informational threshold for flagging a checkout photo taken far from the checkin photo's location — see the "Ubicación distinta" badge on DayCheckinRow/home. Not a validity rule by itself; members still vote if they want to invalidate. */
export const CHECKIN_LOCATION_MISMATCH_METERS = 300;

/**
 * Deliberately the SAME number for two different jobs, so they agree by
 * construction:
 *  1. Clustering — in useMemberCheckinLocations.ts, two past check-ins
 *     within this distance of each other count as "the same spot" (a photo
 *     taken 50m off from last time still merges into the same location,
 *     same occurrence count — GPS drift/where-exactly-you-stood shouldn't
 *     fragment one real gym into several distinct low-count locations).
 *  2. Detection — in checkinArrivalReminders.ts, the actual geofence/
 *     foreground-watch radius used to decide "the member has arrived".
 * If a location was ever "close enough" to be learned as the same spot,
 * arriving there again is guaranteed to be "close enough" to trigger it.
 */
export const CHECKIN_ARRIVAL_RADIUS_METERS = 100;

export interface DatedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  /** Most recent checkin_date this cluster was used for. */
  lastUsedDate: string;
  /** How many input rows merged into this cluster. */
  occurrenceCount: number;
}

/**
 * Greedily clusters a most-recent-first list of dated coordinates into
 * distinct spots: a row joins the first existing cluster within
 * CHECKIN_ARRIVAL_RADIUS_METERS of it, rather than requiring an exact (or
 * fixed-grid-rounded) match — so two check-ins at the same real gym but
 * with GPS drift, or simply standing in a slightly different spot each
 * time, still count as the same location instead of splintering into
 * separate low-count entries. Each cluster's coordinate is a running
 * centroid (the mean of every row merged into it so far); `lastUsedDate`/
 * `accuracyMeters` come from whichever row started the cluster, which —
 * since the input is most-recent-first — is already that cluster's most
 * recent occurrence.
 */
export function clusterLocations<T extends { checkinDate: string; latitude: number; longitude: number; accuracyMeters: number | null }>(
  rows: readonly T[]
): DatedLocation[] {
  const clusters: DatedLocation[] = [];
  for (const row of rows) {
    const cluster = clusters.find(
      (c) => distanceMeters(c.latitude, c.longitude, row.latitude, row.longitude) <= CHECKIN_ARRIVAL_RADIUS_METERS
    );
    if (cluster) {
      const n = cluster.occurrenceCount + 1;
      // Incremental mean — converges toward the cluster's real center as
      // more check-ins join it, instead of staying pinned to wherever the
      // very first one happened to be.
      cluster.latitude += (row.latitude - cluster.latitude) / n;
      cluster.longitude += (row.longitude - cluster.longitude) / n;
      cluster.occurrenceCount = n;
    } else {
      clusters.push({
        latitude: row.latitude,
        longitude: row.longitude,
        accuracyMeters: row.accuracyMeters,
        lastUsedDate: row.checkinDate,
        occurrenceCount: 1,
      });
    }
  }
  return clusters;
}

/**
 * Picks the single "current gym" out of a member's clustered check-in spots
 * (see clusterLocations) — the most frequently used one. A location used
 * only once never qualifies (minOccurrences) — a single check-in somewhere
 * doesn't make it "where this member trains", it's a one-off (e.g. a single
 * at-home session). A genuine tie in frequency (e.g. 10 home / 10 gym in
 * the lookback window) goes to whichever was used more recently — training
 * mostly at the gym lately after a period of mostly-home should track the
 * gym, not get stuck on whichever happened to be seen first.
 *
 * Deliberately singular, not "top N": watching more than one recurring spot
 * would mean also watching wherever a member trains often but isn't
 * actually forgetful about (e.g. a home routine they already have down) —
 * the reminder only needs to follow the one place they're most likely to
 * be checking in from right now.
 */
export function pickPrimaryLocation(locations: readonly DatedLocation[], minOccurrences = 2): DatedLocation | null {
  const eligible = locations.filter((l) => l.occurrenceCount >= minOccurrences);
  if (eligible.length === 0) return null;
  const maxCount = Math.max(...eligible.map((l) => l.occurrenceCount));
  const topTied = eligible.filter((l) => l.occurrenceCount === maxCount);
  return topTied.reduce((latest, l) => (l.lastUsedDate > latest.lastUsedDate ? l : latest));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle (haversine) distance between two coordinates, in meters. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

// ---- Buddy check-ins --------------------------------------------------------
// "Trained together": two different members' check-ins on the same calendar
// day, close enough in both time and place that they were plausibly at the
// gym at the same time. Rewarded with bonus XP + the 'dupla' badge (see
// xp.ts/badges.ts) and surfaced right after check-in (checkin/preview.tsx).

export const BUDDY_CHECKIN_MAX_METERS = 100;
export const BUDDY_CHECKIN_MAX_MINUTES = 10;

export interface BuddyCheckinPoint {
  userId: string;
  date: string;
  capturedAtMs: number;
  latitude: number;
  longitude: number;
}

function isBuddyMatch(a: BuddyCheckinPoint, b: BuddyCheckinPoint): boolean {
  if (a.userId === b.userId || a.date !== b.date) return false;
  if (Math.abs(a.capturedAtMs - b.capturedAtMs) / 60000 > BUDDY_CHECKIN_MAX_MINUTES) return false;
  return distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude) <= BUDDY_CHECKIN_MAX_METERS;
}

/**
 * Group-wide: every (userId, date) that had at least one OTHER member's
 * check-in within BUDDY_CHECKIN_MAX_METERS/MINUTES that same day, as
 * `${userId}|${date}` keys — one entry per member per day no matter how many
 * others they matched with. O(members²) per day, which is fine at real group
 * sizes. Feeds each member's buddyCheckinCount in BadgeContext (see
 * useGroupBadges.ts).
 */
export function findBuddyCheckinKeys(points: readonly BuddyCheckinPoint[]): Set<string> {
  const keys = new Set<string>();
  const byDate = new Map<string, BuddyCheckinPoint[]>();
  for (const p of points) {
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date)!.push(p);
  }
  for (const dayPoints of byDate.values()) {
    for (let i = 0; i < dayPoints.length; i++) {
      for (let j = i + 1; j < dayPoints.length; j++) {
        if (!isBuddyMatch(dayPoints[i], dayPoints[j])) continue;
        keys.add(`${dayPoints[i].userId}|${dayPoints[i].date}`);
        keys.add(`${dayPoints[j].userId}|${dayPoints[j].date}`);
      }
    }
  }
  return keys;
}

/**
 * The first of `others` that buddy-matches `mine` (if any) — used right
 * after a single check-in to say "you trained with X", where we only care
 * about one's own match, not the whole group's.
 */
export function findBuddyPartner<T extends BuddyCheckinPoint>(mine: BuddyCheckinPoint, others: readonly T[]): T | null {
  return others.find((o) => isBuddyMatch(mine, o)) ?? null;
}
