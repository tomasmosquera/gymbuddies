import {
  clusterLocations,
  distanceMeters,
  findBuddyCheckinKeys,
  findBuddyPartner,
  pickPrimaryLocation,
  type BuddyCheckinPoint,
  type DatedLocation,
} from '@/lib/domain/geo';

describe('distanceMeters', () => {
  it('returns 0 for the same coordinate', () => {
    expect(distanceMeters(4.711, -74.0721, 4.711, -74.0721)).toBe(0);
  });

  it('matches a known distance between two real-world points (~1 km apart)', () => {
    // 0.009 degrees of latitude is ~1,000m (111,320m per degree) — same longitude
    // isolates this to a pure north-south distance, easy to sanity-check by hand.
    const distance = distanceMeters(4.711, -74.0721, 4.72, -74.0721);
    expect(distance).toBeGreaterThan(900);
    expect(distance).toBeLessThan(1100);
  });

  it('a 100m-radius geofence threshold correctly separates near vs far points', () => {
    const near = distanceMeters(4.711, -74.0721, 4.7115, -74.0721); // ~56m north
    const far = distanceMeters(4.711, -74.0721, 4.713, -74.0721); // ~333m north
    expect(near).toBeLessThan(100);
    expect(far).toBeGreaterThan(100);
  });
});

describe('clusterLocations', () => {
  it('merges two check-ins into one cluster when GPS drift puts them ~50m apart (same real gym, different exact spot)', () => {
    const rows = [
      { checkinDate: '2026-01-10', latitude: 4.711, longitude: -74.0721, accuracyMeters: 10 },
      { checkinDate: '2026-01-05', latitude: 4.7114, longitude: -74.0721, accuracyMeters: 10 }, // ~45m north
    ];
    const clusters = clusterLocations(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].occurrenceCount).toBe(2);
    expect(clusters[0].lastUsedDate).toBe('2026-01-10');
  });

  it('keeps two genuinely distant spots as separate clusters', () => {
    const rows = [
      { checkinDate: '2026-01-10', latitude: 4.711, longitude: -74.0721, accuracyMeters: 10 }, // "gym"
      { checkinDate: '2026-01-09', latitude: 4.75, longitude: -74.05, accuracyMeters: 10 }, // "home", far away
    ];
    const clusters = clusterLocations(rows);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.occurrenceCount === 1)).toBe(true);
  });

  it("averages a cluster's coordinate toward its real center as more rows join it", () => {
    const rows = [
      { checkinDate: '2026-01-03', latitude: 4.7112, longitude: -74.0721, accuracyMeters: 10 },
      { checkinDate: '2026-01-02', latitude: 4.711, longitude: -74.0721, accuracyMeters: 10 },
      { checkinDate: '2026-01-01', latitude: 4.7108, longitude: -74.0721, accuracyMeters: 10 },
    ];
    const [cluster] = clusterLocations(rows);
    expect(cluster.occurrenceCount).toBe(3);
    expect(cluster.latitude).toBeCloseTo(4.711, 5);
  });

  it('a one-off check-in far from everything else stays its own single-occurrence cluster', () => {
    const rows = [
      { checkinDate: '2026-01-10', latitude: 4.711, longitude: -74.0721, accuracyMeters: 10 },
      { checkinDate: '2026-01-09', latitude: 4.711, longitude: -74.0721, accuracyMeters: 10 },
      { checkinDate: '2026-01-01', latitude: 4.75, longitude: -74.05, accuracyMeters: 10 }, // a single at-home session
    ];
    const clusters = clusterLocations(rows);
    expect(clusters).toHaveLength(2);
    const home = clusters.find((c) => c.occurrenceCount === 1);
    expect(home).toBeDefined();
  });
});

function location(overrides: Partial<DatedLocation>): DatedLocation {
  return { latitude: 4.71, longitude: -74.07, accuracyMeters: 10, lastUsedDate: '2026-01-01', occurrenceCount: 1, ...overrides };
}

describe('pickPrimaryLocation', () => {
  it('returns null when nothing has more than one occurrence', () => {
    const locations = [location({ occurrenceCount: 1 }), location({ latitude: 4.75, occurrenceCount: 1 })];
    expect(pickPrimaryLocation(locations)).toBeNull();
  });

  it('picks the clearly more frequent location, ignoring a one-off', () => {
    const gym = location({ latitude: 4.71, occurrenceCount: 10, lastUsedDate: '2026-01-10' });
    const home = location({ latitude: 4.75, occurrenceCount: 1, lastUsedDate: '2026-01-09' });
    expect(pickPrimaryLocation([home, gym])).toBe(gym);
  });

  it('breaks an exact frequency tie by picking the more recently used one — 10 home vs 10 gym, gym visited more recently', () => {
    const home = location({ latitude: 4.75, occurrenceCount: 10, lastUsedDate: '2026-01-05' });
    const gym = location({ latitude: 4.71, occurrenceCount: 10, lastUsedDate: '2026-01-10' });
    expect(pickPrimaryLocation([home, gym])).toBe(gym);
  });

  it('the same tie the other way round picks home when home was used more recently', () => {
    const home = location({ latitude: 4.75, occurrenceCount: 10, lastUsedDate: '2026-01-10' });
    const gym = location({ latitude: 4.71, occurrenceCount: 10, lastUsedDate: '2026-01-05' });
    expect(pickPrimaryLocation([home, gym])).toBe(home);
  });

  it('a single check-in never qualifies even with no competing location', () => {
    expect(pickPrimaryLocation([location({ occurrenceCount: 1 })])).toBeNull();
  });
});

function point(overrides: Partial<BuddyCheckinPoint>): BuddyCheckinPoint {
  return {
    userId: 'a',
    date: '2026-01-10',
    capturedAtMs: Date.parse('2026-01-10T08:00:00Z'),
    latitude: 4.711,
    longitude: -74.0721,
    ...overrides,
  };
}

describe('findBuddyCheckinKeys', () => {
  it('pairs two members within 100m and 10 minutes on the same day', () => {
    const a = point({ userId: 'a', capturedAtMs: Date.parse('2026-01-10T08:00:00Z') });
    const b = point({ userId: 'b', capturedAtMs: Date.parse('2026-01-10T08:05:00Z') }); // 5 min later, same spot
    const keys = findBuddyCheckinKeys([a, b]);
    expect(keys.has('a|2026-01-10')).toBe(true);
    expect(keys.has('b|2026-01-10')).toBe(true);
  });

  it('does not pair the same user with themselves', () => {
    const a1 = point({ userId: 'a', capturedAtMs: Date.parse('2026-01-10T08:00:00Z') });
    const a2 = point({ userId: 'a', capturedAtMs: Date.parse('2026-01-10T08:05:00Z') });
    expect(findBuddyCheckinKeys([a1, a2]).size).toBe(0);
  });

  it('does not pair check-ins more than 10 minutes apart', () => {
    const a = point({ userId: 'a', capturedAtMs: Date.parse('2026-01-10T08:00:00Z') });
    const b = point({ userId: 'b', capturedAtMs: Date.parse('2026-01-10T08:11:00Z') }); // 11 min later
    expect(findBuddyCheckinKeys([a, b]).size).toBe(0);
  });

  it('does not pair check-ins more than 100m apart', () => {
    const a = point({ userId: 'a', latitude: 4.711, longitude: -74.0721 });
    const b = point({ userId: 'b', latitude: 4.713, longitude: -74.0721 }); // ~333m away
    expect(findBuddyCheckinKeys([a, b]).size).toBe(0);
  });

  it('does not pair check-ins on different days even if close in time-of-day and place', () => {
    const a = point({ userId: 'a', date: '2026-01-10' });
    const b = point({ userId: 'b', date: '2026-01-11' });
    expect(findBuddyCheckinKeys([a, b]).size).toBe(0);
  });

  it('a third, unrelated check-in that day never gets pulled in as a false pair', () => {
    const a = point({ userId: 'a', capturedAtMs: Date.parse('2026-01-10T08:00:00Z') });
    const b = point({ userId: 'b', capturedAtMs: Date.parse('2026-01-10T08:05:00Z') });
    const c = point({ userId: 'c', capturedAtMs: Date.parse('2026-01-10T20:00:00Z') }); // same day, hours later
    const keys = findBuddyCheckinKeys([a, b, c]);
    expect(keys.has('c|2026-01-10')).toBe(false);
  });
});

describe('findBuddyPartner', () => {
  it('returns the matching teammate when one exists', () => {
    const mine = point({ userId: 'me', capturedAtMs: Date.parse('2026-01-10T08:00:00Z') });
    const partner = point({ userId: 'friend', capturedAtMs: Date.parse('2026-01-10T08:03:00Z') });
    expect(findBuddyPartner(mine, [partner])).toBe(partner);
  });

  it('returns null when nobody matches', () => {
    const mine = point({ userId: 'me', capturedAtMs: Date.parse('2026-01-10T08:00:00Z') });
    const stranger = point({ userId: 'other', capturedAtMs: Date.parse('2026-01-10T20:00:00Z') });
    expect(findBuddyPartner(mine, [stranger])).toBeNull();
  });
});
