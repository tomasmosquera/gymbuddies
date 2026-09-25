import type { AchievementsClient } from '@/lib/achievements/client';
import { fetchGroupAttendanceRecords } from '@/lib/achievements/groupAttendanceRecords';
import { fetchGroupMonthlyChallenges } from '@/lib/achievements/groupMonthlyChallenges';
import { fetchGroupBadges, type MemberBadges } from '@/lib/achievements/groupBadges';
import { BADGES } from '@/lib/domain/badges';
import { MONTHLY_CHALLENGES } from '@/lib/domain/monthlyChallenges';

/**
 * The whole job of the notify-achievements Edge Function, with the Supabase
 * client passed in so it runs (and is unit-tested) outside Deno too.
 *
 * It does NOT compute achievements itself: it asks the same three functions
 * the app uses (fetchGroupAttendanceRecords -> fetchGroupMonthlyChallenges ->
 * fetchGroupBadges), then diffs the result against what was already pushed.
 * The previous version kept its own copy of that computation and silently
 * drifted out of sync with the app — it threw on every group with members.
 */

/**
 * Safety net against a burst: at most this many pushes per PERSON per run,
 * counted across every group they belong to; anything beyond it is recorded as
 * notified but NOT sent (and counted in the result). A member legitimately
 * unlocking several things at once stays well under it; what it protects
 * against is a catalog change (e.g. new badges that existing members already
 * qualify for) turning into a wall of pushes.
 */
export const MAX_PUSHES_PER_MEMBER_PER_RUN = 5;

export interface PendingNotification {
  kind: 'badge' | 'challenge' | 'level';
  /** badge id or monthly challenge id (unused for a level-up) */
  achievementId: string;
  /** 'lifetime' for a badge, the YYYY-MM month for a monthly challenge, '' for a level-up */
  period: string;
  /** only for kind 'level' */
  level: number;
  title: string;
  body: string;
  broadcastTitle: string;
  broadcastBody: string;
}

/**
 * What this member has earned that nobody has been told about yet. Pure —
 * given the evaluated member and the "already notified" state, no I/O.
 */
export function pendingNotificationsFor(
  member: MemberBadges,
  alreadyNotified: ReadonlySet<string>,
  lastNotifiedLevel: number
): PendingNotification[] {
  const pending: PendingNotification[] = [];

  for (const badge of BADGES) {
    if (!member.statuses[badge.id]?.earned) continue;
    if (alreadyNotified.has(`${member.userId}|${badge.id}|lifetime`)) continue;
    pending.push({
      kind: 'badge',
      achievementId: badge.id,
      period: 'lifetime',
      level: 0,
      title: `${badge.emoji} ¡Nuevo logro desbloqueado!`,
      body: `Conseguiste "${badge.name}" — ${badge.description}`,
      broadcastTitle: `${badge.emoji} ¡Nuevo logro en el grupo!`,
      broadcastBody: `${member.fullName} consiguió "${badge.name}" — ${badge.description}`,
    });
  }

  // earnedMonths is exactly the set of months the app credits: monotonic
  // challenges include the still-open current month, comparative ones only
  // closed months.
  for (const challenge of MONTHLY_CHALLENGES) {
    for (const month of member.monthlyStatuses[challenge.id]?.earnedMonths ?? []) {
      if (alreadyNotified.has(`${member.userId}|${challenge.id}|${month}`)) continue;
      pending.push({
        kind: 'challenge',
        achievementId: challenge.id,
        period: month,
        level: 0,
        title: `${challenge.emoji} ¡Reto del mes cumplido!`,
        body: `Conseguiste "${challenge.name}" — ${challenge.description}`,
        broadcastTitle: `${challenge.emoji} ¡Reto del mes cumplido en el grupo!`,
        broadcastBody: `${member.fullName} cumplió el reto "${challenge.name}" — ${challenge.description}`,
      });
    }
  }

  // Levels start at 0 (level 1 takes 100 XP), so level 0 never announces anything
  // and reaching level 1 is a real level-up. `lastNotifiedLevel` defaults to 0.
  const level = member.level.level;
  if (level > lastNotifiedLevel) {
    pending.push({
      kind: 'level',
      achievementId: 'level',
      period: '',
      level,
      title: '🎉 ¡Subiste de nivel!',
      body: `Ahora eres nivel ${level}.`,
      broadcastTitle: '🎉 ¡Alguien subió de nivel!',
      broadcastBody: `${member.fullName} ahora es nivel ${level}.`,
    });
  }

  return pending;
}

export interface NotifyOptions {
  /**
   * Record everything currently true as already notified WITHOUT sending a
   * single push, for every group (dirty or not). Run this once after the
   * catalog or the computation changed, so existing members aren't sent a
   * notification for every achievement they already had.
   */
  baselineOnly: boolean;
}

export interface NotifyResult {
  ok: boolean;
  baselineOnly: boolean;
  groupsProcessed: number;
  groupsFailed: number;
  pushesSent: number;
  /** Achievements recorded as notified without a push (baseline mode, or over the per-member cap). */
  recordedSilently: number;
  errors: { groupId: string; message: string }[];
}

interface Tally {
  pushesSent: number;
  /** Pushes sent to each person so far this run, across all their groups — what the per-person cap is measured against. */
  pushesByUser: Map<string, number>;
  recordedSilently: number;
  memberFailures: number;
  errors: { groupId: string; message: string }[];
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function deliverOne(
  client: AchievementsClient,
  groupId: string,
  member: MemberBadges,
  otherMemberIds: string[],
  pending: PendingNotification,
  previousLevel: number,
  send: boolean,
  tally: Tally
): Promise<void> {
  // 1) record first — if a concurrent run already recorded it (unique violation)
  //    we must not push a second time.
  if (pending.kind === 'level') {
    const { error } = await client
      .from('member_level_notifications')
      .upsert({ group_id: groupId, user_id: member.userId, last_notified_level: pending.level, updated_at: new Date().toISOString() });
    if (error) throw new Error(`could not record level for ${member.userId}: ${error.message}`);
  } else {
    const { error } = await client
      .from('member_achievement_notifications')
      .insert({ group_id: groupId, user_id: member.userId, badge_id: pending.achievementId, period: pending.period });
    if (error) return; // already recorded elsewhere
  }

  if (!send) {
    tally.recordedSilently++;
    return;
  }

  // 2) push. If the achiever's own push fails, undo the record so the next run retries
  //    instead of losing the notification for good.
  const personal = await client.rpc('send_push_notification', {
    p_user_ids: [member.userId],
    p_title: pending.title,
    p_body: pending.body,
    p_group_id: groupId,
    p_category: 'achievements',
    p_data: { user_id: member.userId },
  });
  if (personal.error) {
    if (pending.kind === 'level') {
      if (previousLevel > 0) {
        await client
          .from('member_level_notifications')
          .upsert({ group_id: groupId, user_id: member.userId, last_notified_level: previousLevel, updated_at: new Date().toISOString() });
      } else {
        await client.from('member_level_notifications').delete().eq('group_id', groupId).eq('user_id', member.userId);
      }
    } else {
      await client
        .from('member_achievement_notifications')
        .delete()
        .eq('group_id', groupId)
        .eq('user_id', member.userId)
        .eq('badge_id', pending.achievementId)
        .eq('period', pending.period);
    }
    throw new Error(`push failed for ${member.userId}: ${personal.error.message}`);
  }
  tally.pushesSent++;
  tally.pushesByUser.set(member.userId, (tally.pushesByUser.get(member.userId) ?? 0) + 1);

  // The broadcast to teammates is a nice-to-have: if it fails, keep the record
  // (the achiever was told) rather than re-pushing them next run.
  if (otherMemberIds.length > 0) {
    const broadcast = await client.rpc('send_push_notification', {
      p_user_ids: otherMemberIds,
      p_title: pending.broadcastTitle,
      p_body: pending.broadcastBody,
      p_group_id: groupId,
      p_category: 'achievements',
      p_data: { user_id: member.userId },
    });
    if (broadcast.error) tally.errors.push({ groupId, message: `broadcast failed for ${member.userId}: ${broadcast.error.message}` });
  }
}

async function processGroup(
  client: AchievementsClient,
  group: { id: string; timezone: string },
  baselineOnly: boolean,
  tally: Tally
): Promise<void> {
  const { records, groupCreatedDate } = await fetchGroupAttendanceRecords(client, group.id, group.timezone);
  if (records.length === 0) return;
  const membersChallenges = await fetchGroupMonthlyChallenges(client, group.id, group.timezone, records, groupCreatedDate);
  const membersBadges = await fetchGroupBadges(client, group.id, group.timezone, records, groupCreatedDate, membersChallenges);

  const [notifiedRes, levelsRes] = await Promise.all([
    client.from('member_achievement_notifications').select('user_id, badge_id, period').eq('group_id', group.id),
    client.from('member_level_notifications').select('user_id, last_notified_level').eq('group_id', group.id),
  ]);
  // Never guess: treating an unreadable "already notified" list as empty would
  // re-notify every achievement every member ever had.
  if (notifiedRes.error) throw new Error(`could not read notified achievements: ${notifiedRes.error.message}`);
  if (levelsRes.error) throw new Error(`could not read notified levels: ${levelsRes.error.message}`);

  const alreadyNotified = new Set((notifiedRes.data ?? []).map((r) => `${r.user_id}|${r.badge_id}|${r.period}`));
  const lastLevelByUser = new Map((levelsRes.data ?? []).map((r) => [r.user_id, r.last_notified_level]));
  const allMemberIds = records.map((r) => r.userId);

  for (const member of membersBadges) {
    try {
      const previousLevel = lastLevelByUser.get(member.userId) ?? 0;
      const pending = pendingNotificationsFor(member, alreadyNotified, previousLevel);
      const otherMemberIds = allMemberIds.filter((id) => id !== member.userId);
      let suppressed = 0;
      for (const item of pending) {
        const send = !baselineOnly && (tally.pushesByUser.get(member.userId) ?? 0) < MAX_PUSHES_PER_MEMBER_PER_RUN;
        if (!baselineOnly && !send) suppressed++;
        await deliverOne(client, group.id, member, otherMemberIds, item, previousLevel, send, tally);
      }
      if (suppressed > 0) {
        console.warn(
          `notify-achievements: ${member.userId} in group ${group.id} had ${pending.length} new achievements — over the ${MAX_PUSHES_PER_MEMBER_PER_RUN}-push cap, recorded ${suppressed} without a push`
        );
      }
    } catch (err) {
      // One member failing must not stop the rest of the group.
      tally.memberFailures++;
      tally.errors.push({ groupId: group.id, message: errorMessage(err) });
    }
  }
}

export async function runNotifyAchievements(client: AchievementsClient, options: NotifyOptions): Promise<NotifyResult> {
  const { baselineOnly } = options;

  const { data: groups, error: groupsError } = await client.from('groups').select('id, created_at, timezone');
  if (groupsError) throw new Error(`could not list groups: ${groupsError.message}`);

  // If this can't be read every group simply counts as dirty and gets
  // re-evaluated — wasteful but safe, since the diff below is what decides
  // whether anything is sent.
  const { data: checkStates } = await client.from('achievement_check_state').select('group_id, dirty_at, last_checked_at');
  const checkStateByGroup = new Map((checkStates ?? []).map((s) => [s.group_id, s]));

  let groupsProcessed = 0;
  let groupsFailed = 0;
  const tally: Tally = { pushesSent: 0, pushesByUser: new Map(), recordedSilently: 0, memberFailures: 0, errors: [] };

  for (const group of groups ?? []) {
    const state = checkStateByGroup.get(group.id);
    const isDirty = !state || !state.last_checked_at || new Date(state.dirty_at) > new Date(state.last_checked_at);
    if (!baselineOnly && !isDirty) continue;

    const checkStartedAt = new Date().toISOString();
    const failuresBefore = tally.memberFailures;
    try {
      await processGroup(client, group, baselineOnly, tally);
    } catch (err) {
      groupsFailed++;
      tally.errors.push({ groupId: group.id, message: errorMessage(err) });
      continue;
    }
    if (tally.memberFailures > failuresBefore) {
      // Some member failed: leave the group dirty so the next run retries it
      // (what was already recorded is skipped, so nothing is sent twice).
      groupsFailed++;
      continue;
    }
    const { error: stateError } = await client
      .from('achievement_check_state')
      .upsert({ group_id: group.id, last_checked_at: checkStartedAt });
    if (stateError) tally.errors.push({ groupId: group.id, message: `could not mark checked: ${stateError.message}` });
    groupsProcessed++;
  }

  return {
    ok: groupsFailed === 0,
    baselineOnly,
    groupsProcessed,
    groupsFailed,
    pushesSent: tally.pushesSent,
    recordedSilently: tally.recordedSilently,
    errors: tally.errors,
  };
}
