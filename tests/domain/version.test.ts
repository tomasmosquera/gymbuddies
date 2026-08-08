import { compareVersions, isVersionOlderThan } from '@/lib/domain/version';

describe('compareVersions', () => {
  it('compares numerically, not lexicographically — 1.0.10 is newer than 1.0.9', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
  });

  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.2', '1.0.2')).toBe(0);
  });

  it('treats missing parts as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.3', '1.2.9')).toBeGreaterThan(0);
  });

  it('compares major/minor/patch in order', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.2')).toBeLessThan(0);
  });
});

describe('isVersionOlderThan', () => {
  it('is true only when current is strictly behind latest', () => {
    expect(isVersionOlderThan('1.0.2', '1.0.3')).toBe(true);
  });

  it('is false when current is equal to latest', () => {
    expect(isVersionOlderThan('1.0.3', '1.0.3')).toBe(false);
  });

  it('is false when current is newer than a stale/out-of-sync "latest" value — the exact bug this guards against', () => {
    expect(isVersionOlderThan('1.0.3', '1.0.2')).toBe(false);
  });
});
