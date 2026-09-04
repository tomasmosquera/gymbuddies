/**
 * Pure decision logic for the "you arrived at the gym" reminder (see
 * checkinArrivalGeofenceTask.ts) — kept separate from the TaskManager/
 * AsyncStorage glue so the actual rule is unit-testable without mocking
 * native modules.
 */

/** YYYY-MM-DD in the device's own local timezone — only used to dedupe this on-device reminder, NOT the group's business-day boundary (that uses the group's own timezone, see dateUtils.ts's toZonedDateString). Good enough for "did I already nag about this today?". */
export function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface ShouldFireArrivalReminderParams {
  /** todayLocalDateString() at call time. */
  today: string;
  /** Last date (YYYY-MM-DD) the member is known to have checked in, or null if never cached. */
  lastCheckinDateCached: string | null;
  /** Last date (YYYY-MM-DD) this reminder already fired, or null if it never has. */
  lastReminderDateCached: string | null;
}

/**
 * true only when the member hasn't checked in today AND hasn't already been
 * reminded today — keeps the geofence from spamming a notification every
 * time someone re-enters the radius (parking, walking around outside), and
 * never fires once a check-in already exists for today, however it was
 * created (their own camera, or an admin backfill).
 */
export function shouldFireArrivalReminder({
  today,
  lastCheckinDateCached,
  lastReminderDateCached,
}: ShouldFireArrivalReminderParams): boolean {
  if (lastCheckinDateCached === today) return false;
  if (lastReminderDateCached === today) return false;
  return true;
}
