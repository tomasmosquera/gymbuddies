import { WORKOUT_ACTIVITY_URL, type WorkoutActivityProps } from '@/lib/domain/workoutActivity';

const mockStart = jest.fn();
let mockInstances: { update: jest.Mock; end: jest.Mock }[] = [];
let mockLoadFails = false;

jest.mock('@/lib/liveActivity/WorkoutActivity', () => ({
  get default() {
    if (mockLoadFails) throw new Error('native module missing');
    return { start: mockStart, getInstances: () => mockInstances };
  },
}));

const props: WorkoutActivityProps = {
  startedAt: '2026-09-28T14:00:00Z',
  minMinutes: 45,
  groupName: 'Mis 59',
  checkoutUrl: WORKOUT_ACTIVITY_URL,
};
const instance = () => ({ update: jest.fn().mockResolvedValue(undefined), end: jest.fn().mockResolvedValue(undefined) });

function load(os: 'ios' | 'android') {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { executionEnvironment: 'bare' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module graph per platform
  return require('@/lib/liveActivity/workoutLiveActivity') as typeof import('@/lib/liveActivity/workoutLiveActivity');
}

beforeEach(() => {
  mockStart.mockReset();
  mockInstances = [];
  mockLoadFails = false;
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

  it('updates the running one instead of starting a second', async () => {
    const running = instance();
    mockInstances = [running];
    const { syncWorkoutLiveActivity } = load('ios');
    await syncWorkoutLiveActivity({ ...props, startedAt: '2026-09-28T14:10:00Z' });
    expect(mockStart).not.toHaveBeenCalled();
    expect(running.update).toHaveBeenCalledWith({ ...props, startedAt: '2026-09-28T14:10:00Z' });
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
    const { syncWorkoutLiveActivity } = load('ios');
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
