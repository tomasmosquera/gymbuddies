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

/**
 * "DDMMYY" in the device's local time — e.g. 2026-10-06 -> "061026". Used for the date segment of
 * the version string on Perfil (app/(app)/profile/index.tsx), fed from expo-updates' own
 * `Updates.createdAt` (the actual publish time of whichever update — build or OTA — is currently
 * running) instead of a hand-maintained constant, which went stale repeatedly since nothing forced
 * it to be edited on every single deploy — same reason that screen's build-number segment now
 * reads Constants.platform live instead of its own former hand-maintained constant. `null` (dev
 * mode, or expo-updates disabled) renders as '?', same fallback style as the rest of the string.
 */
export function formatDeployDateDDMMYY(date: Date | null): string {
  if (!date) return '?';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  return `${dd}${mm}${yy}`;
}
