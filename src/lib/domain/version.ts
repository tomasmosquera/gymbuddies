/**
 * Compares two "x.y.z" version strings numerically, part by part — not
 * lexicographically ("1.0.10" is newer than "1.0.9", a plain string compare
 * would get that backwards). Missing parts count as 0 ("1.2" == "1.2.0").
 * Returns negative/zero/positive like a standard comparator.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = b.split('.').map((n) => parseInt(n, 10) || 0);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True only when `current` is strictly older than `latest` — never fires just because they differ (e.g. current being newer, or a stale/out-of-sync "latest" value, must never nag). */
export function isVersionOlderThan(current: string, latest: string): boolean {
  return compareVersions(current, latest) < 0;
}
