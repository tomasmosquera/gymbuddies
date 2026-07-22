import { distanceMeters } from '@/lib/domain/geo';

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
