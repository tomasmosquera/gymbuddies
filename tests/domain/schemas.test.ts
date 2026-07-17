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
      vacationDaysPerMonth: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive initial deposit', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 0,
      minDaysPerWeek: 3,
      penaltyAmount: 15000,
      vacationDaysPerMonth: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 7 required days per week', () => {
    const result = createGroupSchema.safeParse({
      name: 'Gym Buddies Bogotá',
      initialDepositAmount: 100000,
      minDaysPerWeek: 8,
      penaltyAmount: 15000,
      vacationDaysPerMonth: 0,
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
});
