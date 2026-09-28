import { annotateHistoryWithRecords, type HistorySession } from '@/lib/domain/exerciseRecords';

const sessions: HistorySession[] = [
  {
    sessionId: 's1',
    date: '2026-08-31T06:30:00Z',
    label: 'Pull',
    sets: [
      { id: 'a', setNumber: 1, reps: 12, weightKg: 20, isWarmup: false },
      { id: 'b', setNumber: 2, reps: 12, weightKg: 20, isWarmup: false },
    ],
  },
  {
    sessionId: 's2',
    date: '2026-09-16T06:26:00Z',
    label: 'Pull',
    sets: [
      { id: 'c', setNumber: 1, reps: 12, weightKg: 20, isWarmup: false },
      { id: 'd', setNumber: 2, reps: 12, weightKg: 20, isWarmup: false },
      { id: 'e', setNumber: 3, reps: 12, weightKg: 20, isWarmup: true }, // warmup — never a PR
    ],
  },
  {
    sessionId: 's3',
    date: '2026-09-23T18:39:00Z',
    label: 'Pull',
    sets: [
      { id: 'f', setNumber: 1, reps: 12, weightKg: 20, isWarmup: false },
      { id: 'g', setNumber: 2, reps: 12, weightKg: 25, isWarmup: false }, // new weight + volume + 1RM PR
      { id: 'h', setNumber: 3, reps: 9, weightKg: 25, isWarmup: false }, // same weight, less volume/reps — no PR
    ],
  },
];

describe('annotateHistoryWithRecords', () => {
  it('flags the very first real set as a PR in all three categories', () => {
    const [first] = annotateHistoryWithRecords(sessions);
    expect(first.sets[0]).toMatchObject({ isWeightPr: true, isVolumePr: true, isOneRepMaxPr: true });
  });

  it('does not re-flag a tie as a new PR', () => {
    const [first] = annotateHistoryWithRecords(sessions);
    // second set of session 1 ties the first set exactly — not a new best
    expect(first.sets[1]).toMatchObject({ isWeightPr: false, isVolumePr: false, isOneRepMaxPr: false });
  });

  it('never flags a warmup set, even if it would otherwise be a PR', () => {
    const annotated = annotateHistoryWithRecords(sessions);
    expect(annotated[1].sets[2]).toMatchObject({ isWeightPr: false, isVolumePr: false, isOneRepMaxPr: false });
  });

  it('flags a genuinely heavier set as a new weight/volume/1RM PR', () => {
    const annotated = annotateHistoryWithRecords(sessions);
    const heavier = annotated[2].sets[1];
    expect(heavier).toMatchObject({ isWeightPr: true, isVolumePr: true, isOneRepMaxPr: true });
  });

  it('does not flag a lower-volume set at the new heaviest weight', () => {
    const annotated = annotateHistoryWithRecords(sessions);
    const lowerVolume = annotated[2].sets[2];
    expect(lowerVolume.isWeightPr).toBe(false);
    expect(lowerVolume.isVolumePr).toBe(false);
  });
});
