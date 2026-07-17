import { isValidInviteCode, normalizeInviteCode } from '@/lib/domain/inviteCode';

describe('normalizeInviteCode', () => {
  it('uppercases and strips surrounding whitespace', () => {
    expect(normalizeInviteCode('  ab3dEfgh  ')).toBe('AB3DEFGH');
  });

  it('strips internal whitespace a user might paste in', () => {
    expect(normalizeInviteCode('ab3d efgh')).toBe('AB3DEFGH');
  });
});

describe('isValidInviteCode', () => {
  it('accepts a well-formed 8 character code from the alphabet', () => {
    expect(isValidInviteCode('AB3DEFGH')).toBe(true);
    expect(isValidInviteCode('ab3defgh')).toBe(true);
  });

  it('rejects the visually ambiguous characters 0, O, 1, I', () => {
    expect(isValidInviteCode('AB3DEFG0')).toBe(false);
    expect(isValidInviteCode('AB3DEFGO')).toBe(false);
    expect(isValidInviteCode('AB3DEFG1')).toBe(false);
    expect(isValidInviteCode('AB3DEFGI')).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(isValidInviteCode('AB3D')).toBe(false);
    expect(isValidInviteCode('AB3DEFGHJ')).toBe(false);
  });
});
