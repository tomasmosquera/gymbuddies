export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const IS_SUPABASE_CONFIGURED = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** Hostname of the /web invite-fallback site (see web/README.md) — e.g. "gymbuddies.vercel.app". Empty until set, so invite-link generation/sharing degrades gracefully instead of building a broken URL. */
export const INVITE_LINK_DOMAIN = process.env.EXPO_PUBLIC_INVITE_LINK_DOMAIN ?? '';
