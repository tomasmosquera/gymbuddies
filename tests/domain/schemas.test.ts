import {
  createGroupSchema,
  joinGroupSchema,
  ruleProposalSchema,
  signUpSchema,
} from '@/lib/validation/schemas';

describe('signUpSchema', () => {
  it('accepts a valid sign-up', () => {
    const result = signUpSchema.safeParse({
      fullName: 'Tomás Mosquera',
      phone: '3001234567',
      email: 'tomas@example.com',
      password: 'supersecret',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a short password', () => {
    const result = signUpSchema.safeParse({
      fullName: 'Tomás Mosquera',
      email: 'tomas@example.com',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = signUpSchema.safeParse({
      fullName: 'Tomás Mosquera',
      email: 'not-an-email',
      password: 'supersecret',
    });
    expect(result.success).toBe(false);
  });
});

describe('createGroupSchema', () => {
  it('accepts a valid group definition', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 100000,
      minDaysPerWeek: 3,
      penaltyAmount: 15000,
      weeklyPenaltyCap: 300000,
      exitFeeAmount: 500000,
      exitNoticeDays: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive initial deposit', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 0,
      minDaysPerWeek: 3,
      penaltyAmount: 15000,
      weeklyPenaltyCap: 300000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 7 required days per week', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 100000,
      minDaysPerWeek: 8,
      penaltyAmount: 15000,
      weeklyPenaltyCap: 300000,
    });
    expect(result.success).toBe(false);
  });

  it('defaults to cooperative mode when payoutMode is omitted', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 100000,
      minDaysPerWeek: 3,
      penaltyAmount: 15000,
      weeklyPenaltyCap: 300000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.payoutMode).toBe('cooperative');
  });

  it('accepts a league mode with custom duration and prize splits', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 100000,
      minDaysPerWeek: 3,
      penaltyAmount: 15000,
      weeklyPenaltyCap: 300000,
      payoutMode: 'league',
      leagueDurationMonths: 6,
      leaguePrizeSplits: [100],
      gameStartsAt: '2026-08-15',
    });
    expect(result.success).toBe(true);
  });

  it('rejects league prize splits summing over 100%', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 100000,
      minDaysPerWeek: 3,
      penaltyAmount: 15000,
      weeklyPenaltyCap: 300000,
      leaguePrizeSplits: [80, 40],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid game start date', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 100000,
      minDaysPerWeek: 3,
      penaltyAmount: 15000,
      weeklyPenaltyCap: 300000,
      gameStartsAt: '15/08/2026',
    });
    expect(result.success).toBe(false);
  });
});

describe('joinGroupSchema', () => {
  it('normalizes and accepts a valid invite code', () => {
    const result = joinGroupSchema.safeParse({ inviteCode: '  ab3defgh  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.inviteCode).toBe('AB3DEFGH');
    }
  });

  it('rejects a malformed invite code', () => {
    const result = joinGroupSchema.safeParse({ inviteCode: 'not-valid' });
    expect(result.success).toBe(false);
  });
});

describe('ruleProposalSchema', () => {
  it('accepts a proposal that changes only one field', () => {
    const result = ruleProposalSchema.safeParse({ penaltyAmount: 20000 });
    expect(result.success).toBe(true);
  });

  it('rejects an empty proposal with no changes', () => {
    const result = ruleProposalSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts a payout-mode change with valid league fields', () => {
    const result = ruleProposalSchema.safeParse({
      payoutMode: 'league',
      leagueDurationMonths: 3,
      leaguePrizeSplits: [60, 30, 10],
    });
    expect(result.success).toBe(true);
  });

  it('rejects prize splits that sum over 100%', () => {
    const result = ruleProposalSchema.safeParse({ leaguePrizeSplits: [70, 40] });
    expect(result.success).toBe(false);
  });

  it('accepts a winner-take-all split', () => {
    const result = ruleProposalSchema.safeParse({ leaguePrizeSplits: [100] });
    expect(result.success).toBe(true);
  });

  it('rejects a mixed share percent out of range', () => {
    const result = ruleProposalSchema.safeParse({ mixedLeagueSharePercent: 150 });
    expect(result.success).toBe(false);
  });
});
