import { createFakeSupabase, type Row } from '../helpers/fakeSupabase';
import { fetchUnseenCycleResults, RESULTS_PROMPT_MAX_AGE_DAYS } from '@/hooks/useLeagueCycleResultsPrompt';

let mockFake = createFakeSupabase({});
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => mockFake.client.from(table),
    rpc: (name: string, args: Record<string, unknown>) => mockFake.client.rpc(name, args),
  },
}));

jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: null }) }));

const GROUP = { id: 'g1', timezone: 'America/Bogota', currency: 'COP' };
const NOW = new Date('2026-11-16T14:00:00Z');

const cycle = (overrides: Row = {}): Row => ({
  id: 'c1', group_id: 'g1', cycle_number: 1, status: 'completed', started_at: '2026-08-17T05:00:00+00:00',
  ends_at: '2026-11-16T04:59:59+00:00', effective_start_date: '2026-08-17', closed_early: false, original_ends_at: null,
  completed_at: '2026-11-16T13:00:00Z', pool_at_payout: 700000, ...overrides,
});
const standing = (user_id: string, place: number, prize = 0): Row => ({
  cycle_id: 'c1', user_id, place, completed_days: 30 - place, failed_days: 0, prize_amount: prize, relegated: false, descenso_amount: 0,
});
const profiles: Row[] = [{ id: 'ana', full_name: 'Ana Gómez' }, { id: 'beto', full_name: 'Beto Ruiz' }];

function setup(tables: Record<string, Row[]>) {
  mockFake = createFakeSupabase({
    league_cycles: [cycle()],
    league_cycle_standings: [standing('ana', 1, 420000), standing('beto', 2, 210000)],
    league_cycle_payouts: [],
    league_cycle_results_seen: [],
    profiles,
    ...tables,
  });
}

describe('fetchUnseenCycleResults', () => {
  it('returns the latest settled cycle for a participant who has not seen it', async () => {
    setup({});
    const found = await fetchUnseenCycleResults(GROUP, 'beto', NOW);
    expect(found?.cycleId).toBe('c1');
    expect(found?.results.endDate).toBe('2026-11-15'); // the Sunday, in the group's timezone
    expect(found?.results.standings.map((s) => s.fullName)).toEqual(['Ana Gómez', 'Beto Ruiz']);
    expect(found?.results.autoRenewed).toBe(false);
  });

  it('shows nothing once this person has a "seen" row — but still shows it to someone else', async () => {
    setup({ league_cycle_results_seen: [{ cycle_id: 'c1', user_id: 'beto' }] });
    expect(await fetchUnseenCycleResults(GROUP, 'beto', NOW)).toBeNull();
    expect(await fetchUnseenCycleResults(GROUP, 'ana', NOW)).not.toBeNull();
  });

  it('shows nothing to someone who did not take part in the cycle', async () => {
    setup({});
    expect(await fetchUnseenCycleResults(GROUP, 'caro', NOW)).toBeNull();
  });

  it('shows nothing for a cycle that settled long ago', async () => {
    setup({ league_cycles: [cycle({ completed_at: '2026-10-01T13:00:00Z' })] });
    expect(RESULTS_PROMPT_MAX_AGE_DAYS).toBeLessThan(46);
    expect(await fetchUnseenCycleResults(GROUP, 'ana', NOW)).toBeNull();
  });

  it('only ever considers the LATEST settled cycle', async () => {
    setup({
      league_cycles: [cycle(), cycle({ id: 'c2', cycle_number: 2, completed_at: '2026-11-16T13:30:00Z' })],
      league_cycle_standings: [{ ...standing('ana', 1), cycle_id: 'c2' }],
    });
    const found = await fetchUnseenCycleResults(GROUP, 'ana', NOW);
    expect(found?.cycleId).toBe('c2');
  });

  it('flags that a new cycle already started (auto-renew)', async () => {
    setup({ league_cycles: [cycle(), cycle({ id: 'c2', cycle_number: 2, status: 'running', completed_at: null })] });
    const found = await fetchUnseenCycleResults(GROUP, 'ana', NOW);
    expect(found?.cycleId).toBe('c1');
    expect(found?.results.autoRenewed).toBe(true);
  });

  it('falls back to the paid places for a cycle without full standings', async () => {
    setup({
      league_cycle_standings: [],
      league_cycle_payouts: [{ cycle_id: 'c1', user_id: 'ana', place: 1, share_percent: 60, amount: 420000 }],
    });
    const found = await fetchUnseenCycleResults(GROUP, 'ana', NOW);
    expect(found?.results.partial).toBe(true);
    expect(found?.results.standings).toHaveLength(1);
  });

  it('shows nothing (never guesses) when the "seen" list cannot be read', async () => {
    setup({});
    mockFake = createFakeSupabase(mockFake.tables, { failSelect: (t) => (t === 'league_cycle_results_seen' ? 'no such table' : null) });
    expect(await fetchUnseenCycleResults(GROUP, 'ana', NOW)).toBeNull();
  });

  it('shows nothing when the group has no settled cycle', async () => {
    setup({ league_cycles: [] });
    expect(await fetchUnseenCycleResults(GROUP, 'ana', NOW)).toBeNull();
  });
});
