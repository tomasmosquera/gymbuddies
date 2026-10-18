import { WORKOUT_ACTIVITY_URL } from '@/lib/domain/workoutActivity';
import { ROUTINE_ACTIVITY_OPEN_URL, ROUTINE_ACTIVITY_SKIP_REST_URL } from '@/lib/domain/routineActivity';
import type { LiveActivityContent } from '@/lib/domain/liveActivityContent';

const mockStart = jest.fn();
let mockInstances: { update: jest.Mock; end: jest.Mock }[] = [];
let mockLoadFails = false;
// A real, stateful stand-in — the fix under test persists which `kind` the running activity was
// started with across AsyncStorage specifically so it survives an app relaunch; a reset-every-call
// mock would silently hide a real regression there.
let mockAsyncStorage: Record<string, string> = {};

jest.mock('@/lib/liveActivity/WorkoutActivity', () => ({
  get default() {
    if (mockLoadFails) throw new Error('native module missing');
    return { start: mockStart, getInstances: () => mockInstances };
  },
}));

const props: LiveActivityContent = {
  kind: 'checkout',
  startedAt: '2026-09-28T14:00:00Z',
  minMinutes: 45,
  groupLabel: 'Mis 59',
  checkoutUrl: WORKOUT_ACTIVITY_URL,
};
const routineProps: LiveActivityContent = {
  kind: 'routine',
  routineName: 'Empuje',
  startedAt: '2026-09-28T14:00:00Z',
  completedSets: 2,
  totalSets: 7,
  restEndAt: null,
  openUrl: ROUTINE_ACTIVITY_OPEN_URL,
  skipRestUrl: ROUTINE_ACTIVITY_SKIP_REST_URL,
};
const instance = () => ({ update: jest.fn().mockResolvedValue(undefined), end: jest.fn().mockResolvedValue(undefined) });

function load(os: 'ios' | 'android') {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { executionEnvironment: 'bare' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
      getItem: jest.fn((key: string) => Promise.resolve(mockAsyncStorage[key] ?? null)),
      setItem: jest.fn((key: string, value: string) => {
        mockAsyncStorage[key] = value;
        return Promise.resolve();
      }),
      removeItem: jest.fn((key: string) => {
        delete mockAsyncStorage[key];
        return Promise.resolve();
      }),
    },
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module graph per platform
  return require('@/lib/liveActivity/workoutLiveActivity') as typeof import('@/lib/liveActivity/workoutLiveActivity');
}

beforeEach(() => {
  mockStart.mockReset();
  mockInstances = [];
  mockLoadFails = false;
  mockAsyncStorage = {};
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('syncWorkoutLiveActivity', () => {
  it('starts one activity, with the deep link, when none is running', async () => {
    const { syncWorkoutLiveActivity } = load('ios');
    await syncWorkoutLiveActivity(props);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledWith(props, WORKOUT_ACTIVITY_URL);
  });

  it('starts a routine activity with its own open-url, not the checkout deep link', async () => {
    const { syncWorkoutLiveActivity } = load('ios');
    await syncWorkoutLiveActivity(routineProps);
    expect(mockStart).toHaveBeenCalledWith(routineProps, ROUTINE_ACTIVITY_OPEN_URL);
  });

  it('updates the running one instead of starting a second', async () => {
    const running = instance();
    mockInstances = [running];
    const { syncWorkoutLiveActivity, ACTIVE_KIND_CACHE_KEY } = load('ios');
    mockAsyncStorage[ACTIVE_KIND_CACHE_KEY] = 'checkout'; // already running for this same kind
    await syncWorkoutLiveActivity({ ...props, startedAt: '2026-09-28T14:10:00Z' });
    expect(mockStart).not.toHaveBeenCalled();
    expect(running.update).toHaveBeenCalledWith({ ...props, startedAt: '2026-09-28T14:10:00Z' });
  });

  it('restarts instead of updating when the running activity was started for the OTHER kind — its tap-anywhere URL can only be set at creation', async () => {
    const running = instance();
    mockInstances = [running];
    const { syncWorkoutLiveActivity, ACTIVE_KIND_CACHE_KEY } = load('ios');
    mockAsyncStorage[ACTIVE_KIND_CACHE_KEY] = 'checkout'; // running, but a checkout-kind one
    await syncWorkoutLiveActivity(routineProps); // now a routine needs to show
    expect(running.update).not.toHaveBeenCalled();
    expect(running.end).toHaveBeenCalledWith('immediate');
    expect(mockStart).toHaveBeenCalledWith(routineProps, ROUTINE_ACTIVITY_OPEN_URL);
  });

  it("doesn't mistake 'never recorded' (e.g. this device just got the fix, activity already running) for a real kind change on the very next sync of the SAME kind", async () => {
    const running = instance();
    mockInstances = [running];
    // No ACTIVE_KIND_CACHE_KEY entry at all — simulates a device whose activity predates this
    // tracking. The first sync after that self-heals (restarts once); a second sync of the same
    // kind right after must settle into updating, not keep restarting forever.
    const { syncWorkoutLiveActivity } = load('ios');
    mockStart.mockImplementation(() => {
      const started = instance();
      mockInstances = [started];
      return started;
    });
    await syncWorkoutLiveActivity(props);
    expect(mockStart).toHaveBeenCalledTimes(1);
    const restarted = mockInstances[0];
    await syncWorkoutLiveActivity({ ...props, startedAt: '2026-09-28T14:10:00Z' });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(restarted.update).toHaveBeenCalledWith({ ...props, startedAt: '2026-09-28T14:10:00Z' });
  });

  it('ends every running activity when there should be none', async () => {
    const a = instance();
    const b = instance();
    mockInstances = [a, b];
    const { syncWorkoutLiveActivity } = load('ios');
    await syncWorkoutLiveActivity(null);
    expect(a.end).toHaveBeenCalledWith('immediate');
    expect(b.end).toHaveBeenCalledWith('immediate');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('collapses duplicates left over from before into one', async () => {
    const a = instance();
    const b = instance();
    mockInstances = [a, b];
    const { syncWorkoutLiveActivity, ACTIVE_KIND_CACHE_KEY } = load('ios');
    mockAsyncStorage[ACTIVE_KIND_CACHE_KEY] = 'checkout'; // the kept instance (a) matches this kind
    await syncWorkoutLiveActivity(props);
    expect(a.update).toHaveBeenCalledWith(props);
    expect(b.end).toHaveBeenCalledWith('immediate');
  });

  it('two syncs fired back to back never start two activities', async () => {
    const { syncWorkoutLiveActivity } = load('ios');
    mockStart.mockImplementation(() => {
      const started = instance();
      mockInstances = [started];
      return started;
    });
    await Promise.all([syncWorkoutLiveActivity(props), syncWorkoutLiveActivity(props)]);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all on Android', async () => {
    const { syncWorkoutLiveActivity } = load('android');
    await syncWorkoutLiveActivity(props);
    await syncWorkoutLiveActivity(null);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('does nothing when the native module is not in this build', async () => {
    mockLoadFails = true;
    const { syncWorkoutLiveActivity } = load('ios');
    await expect(syncWorkoutLiveActivity(props)).resolves.toBeUndefined();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('never throws when iOS refuses the activity (e.g. Live Activities switched off)', async () => {
    mockStart.mockImplementation(() => {
      throw new Error('activities are disabled');
    });
    const { syncWorkoutLiveActivity } = load('ios');
    await expect(syncWorkoutLiveActivity(props)).resolves.toBeUndefined();
  });
});
