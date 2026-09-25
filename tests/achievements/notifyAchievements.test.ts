import {
  MAX_PUSHES_PER_MEMBER_PER_RUN,
  pendingNotificationsFor,
  runNotifyAchievements,
} from '@/lib/achievements/notifyAchievements';
import type { MemberBadges } from '@/lib/achievements/groupBadges';
import { toZonedDateString } from '@/lib/domain/dateUtils';
import { levelProgress } from '@/lib/domain/xp';
import { createFakeSupabase, type FakeOptions, type Row } from '../helpers/fakeSupabase';

const TZ = 'America/Bogota';
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => toZonedDateString(new Date(Date.now() - n * DAY_MS), TZ);

// ---- pure part: what is worth announcing ----------------------------------------------------

function memberWith(overrides: Partial<MemberBadges> = {}): MemberBadges {
  return {
    userId: 'u1',
    fullName: 'Ana Gómez',
    statuses: {},
    earnedCount: 0,
    monthlyStatuses: {},
    level: levelProgress(0),
    kothClaimXpTotal: 0,
    checkinXpTotal: 0,
    kothClaims: [],
    buddyCheckinXpTotal: 0,
    buddyCheckinCount: 0,
    ...overrides,
  };
}
const earned = { earned: true, current: 1, target: 1, earnedDate: '2026-08-01' };

describe('pendingNotificationsFor', () => {
  it('announces an earned badge once, addressed to the achiever and to teammates', () => {
    const [n] = pendingNotificationsFor(memberWith({ statuses: { 'primer-paso': earned } }), new Set(), 1);
    expect(n.kind).toBe('badge');
    expect(n.period).toBe('lifetime');
    expect(n.title).toContain('¡Nuevo logro desbloqueado!');
    expect(n.body).toContain('Conseguiste');
    expect(n.broadcastBody).toContain('Ana Gómez consiguió');
  });

  it('skips what was already notified', () => {
    const pending = pendingNotificationsFor(memberWith({ statuses: { 'primer-paso': earned } }), new Set(['u1|primer-paso|lifetime']), 1);
    expect(pending).toHaveLength(0);
  });

  it('announces each earned month of a monthly challenge separately, skipping notified months', () => {
    const member = memberWith({
      monthlyStatuses: {
        'empezamos-bien': { timesAchieved: 2, monthsEvaluated: 2, currentMonthEarned: null, currentMonthProgress: null, earnedMonths: ['2026-07', '2026-08'] },
      },
    });
    const pending = pendingNotificationsFor(member, new Set(['u1|empezamos-bien|2026-07']), 1);
    expect(pending.map((p) => [p.kind, p.period])).toEqual([['challenge', '2026-08']]);
  });

  it('announces each level-up, including the first one — but nothing at level 0, where everyone starts', () => {
    const start = levelProgress(0);
    const first = levelProgress(100); // level 1 takes 100 XP
    const higher = levelProgress(2000);
    expect(start.level).toBe(0);
    expect(first.level).toBe(1);
    expect(higher.level).toBeGreaterThan(1);

    expect(pendingNotificationsFor(memberWith({ level: start }), new Set(), 0)).toHaveLength(0);
    expect(pendingNotificationsFor(memberWith({ level: first }), new Set(), 0).map((p) => p.body)).toEqual(['Ahora eres nivel 1.']);
    const [n] = pendingNotificationsFor(memberWith({ level: higher }), new Set(), higher.level - 1);
    expect(n.kind).toBe('level');
    expect(n.body).toBe(`Ahora eres nivel ${higher.level}.`);
    expect(pendingNotificationsFor(memberWith({ level: higher }), new Set(), higher.level)).toHaveLength(0);
  });
});

// ---- the whole run, against an in-memory Supabase --------------------------------------------

/** A group whose member Ana has checked in EVERY day for ~13 months (so she earns a lot of badges) and member Beto has not. */
function fixture(): Record<string, Row[]> {
  const created = `${daysAgo(400)}T00:00:00Z`;
  const member = (user_id: string, name: string): Row => ({
    group_id: 'g1', user_id, balance: 0, activated_at: created, penalty_start_date: null, joined_at: created, status: 'active',
    profile: { full_name: name }, group: { min_days_per_week: 3, created_at: created },
  });
  const checkins: Row[] = [];
  for (let i = 399; i >= 1; i--) {
    const date = daysAgo(i);
    checkins.push({ group_id: 'g1', user_id: 'ana', checkin_date: date, captured_at: `${date}T15:00:00Z`, workout_minutes: null, latitude: null, longitude: null });
  }
  return {
    groups: [{ id: 'g1', created_at: created, timezone: TZ, require_checkout_photo: false }],
    group_members: [member('ana', 'Ana Gómez'), member('beto', 'Beto Ruiz')],
    checkins,
  };
}

/** A push to the person who achieved it (p_data.user_id is always the achiever) — as opposed to the broadcast to their teammates. */
const personal = (c: { args: Record<string, unknown> }) =>
  (c.args.p_user_ids as string[])[0] === (c.args.p_data as { user_id: string }).user_id;
const forget = (tables: Record<string, Row[]>, predicate: (r: Row) => boolean) => {
  const t = tables.member_achievement_notifications;
  const at = t.findIndex(predicate);
  return at >= 0 ? t.splice(at, 1)[0] : null;
};
const markDirty = (tables: Record<string, Row[]>) => {
  const now = Date.now();
  tables.achievement_check_state = [
    { group_id: 'g1', last_checked_at: new Date(now - 2 * 3600_000).toISOString(), dirty_at: new Date(now - 3600_000).toISOString() },
  ];
};
const run = (fake: ReturnType<typeof createFakeSupabase>, baselineOnly: boolean) =>
  runNotifyAchievements(fake.client as never, { baselineOnly });

describe('runNotifyAchievements', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('baseline records what is already earned WITHOUT sending a single push', async () => {
    const fake = createFakeSupabase(fixture());
    const res = await run(fake, true);
    expect(res.ok).toBe(true);
    expect(fake.rpcCalls).toHaveLength(0);
    expect(res.pushesSent).toBe(0);
    expect(fake.tables.member_achievement_notifications.length).toBeGreaterThan(0);
    expect(fake.tables.achievement_check_state[0].last_checked_at).toBeTruthy();
  });

  it('after a baseline, a run with nothing new sends nothing', async () => {
    const fake = createFakeSupabase(fixture());
    await run(fake, true);
    markDirty(fake.tables);
    const res = await run(fake, false);
    expect(res.ok).toBe(true);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('a genuinely new achievement produces exactly one push to the achiever and one to the teammate — once', async () => {
    const fake = createFakeSupabase(fixture());
    await run(fake, true);
    const removed = forget(fake.tables, (r) => r.user_id === 'ana' && r.badge_id === 'primer-paso' && r.period === 'lifetime');
    expect(removed).not.toBeNull(); // Ana has earned it, so the baseline recorded it
    markDirty(fake.tables);

    await run(fake, false);
    const calls = fake.rpcCalls;
    expect(calls.filter(personal)).toHaveLength(1);
    expect(calls.filter((c) => !personal(c))).toHaveLength(1);
    expect(calls.find(personal)!.args).toMatchObject({ p_user_ids: ['ana'], p_category: 'achievements', p_group_id: 'g1' });
    expect(calls.find((c) => !personal(c))!.args.p_user_ids).toEqual(['beto']);

    markDirty(fake.tables);
    await run(fake, false);
    expect(fake.rpcCalls).toHaveLength(calls.length); // not sent a second time
  });

  it('never sends more than the per-person cap in one run, recording the rest without a push', async () => {
    const fake = createFakeSupabase(fixture()); // NO baseline: Ana has lots of unnotified badges
    const res = await run(fake, false);
    const toAna = fake.rpcCalls.filter((c) => personal(c) && (c.args.p_user_ids as string[])[0] === 'ana');
    expect(toAna.length).toBeLessThanOrEqual(MAX_PUSHES_PER_MEMBER_PER_RUN);
    expect(res.recordedSilently).toBeGreaterThan(0);
    // ...and nothing is left to send on the next run.
    markDirty(fake.tables);
    const before = fake.rpcCalls.length;
    await run(fake, false);
    expect(fake.rpcCalls).toHaveLength(before);
  });

  it('if the push fails, the record is undone so it is retried — and delivered once when the service recovers', async () => {
    const options: FakeOptions = { failRpc: () => 'push service down' };
    const failing = createFakeSupabase(fixture(), options);
    await run(failing, true);
    forget(failing.tables, (r) => r.user_id === 'ana' && r.badge_id === 'primer-paso');
    markDirty(failing.tables);

    const res = await run(failing, false);
    expect(res.ok).toBe(false);
    expect(failing.tables.member_achievement_notifications.some((r) => r.user_id === 'ana' && r.badge_id === 'primer-paso')).toBe(false);
    const state = failing.tables.achievement_check_state[0];
    expect((state.dirty_at as string) > (state.last_checked_at as string)).toBe(true); // stays dirty for the retry

    const healthy = createFakeSupabase(failing.tables);
    markDirty(healthy.tables);
    await run(healthy, false);
    expect(healthy.rpcCalls.filter(personal)).toHaveLength(1);
  });

  it('if the "already notified" list cannot be read it fails that group and sends nothing (never guesses)', async () => {
    const fake = createFakeSupabase(fixture(), {
      failSelect: (table) => (table === 'member_achievement_notifications' ? 'permission denied' : null),
    });
    const res = await run(fake, false);
    expect(res.ok).toBe(false);
    expect(res.groupsFailed).toBe(1);
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.tables.member_achievement_notifications ?? []).toHaveLength(0);
  });

  it('a group with no active members is skipped cleanly', async () => {
    const tables = fixture();
    tables.group_members = [];
    const fake = createFakeSupabase(tables);
    const res = await run(fake, false);
    expect(res.ok).toBe(true);
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
