/**
 * Mirrors generate_invite_code()'s alphabet (supabase/migrations/0007).
 * Excludes visually ambiguous characters: 0/O, 1/I.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

const VALID_CODE_RE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

/** Uppercases and strips whitespace, matching how join_group() normalizes input. */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidInviteCode(raw: string): boolean {
  return VALID_CODE_RE.test(normalizeInviteCode(raw));
}
