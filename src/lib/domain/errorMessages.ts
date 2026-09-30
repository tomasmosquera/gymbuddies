const NETWORK_ERROR_PATTERN = /network connection was lost|network request failed|internet connection appears to be offline/i;

/**
 * True for the transient, connectivity-only failures (iOS's
 * NSURLErrorDomain -1005 "The network connection was lost", RN's own
 * "Network request failed", etc.) — fires whenever the app backgrounds, the
 * screen locks, or the network hands off (wifi <-> cellular) while a
 * request is in flight, or on a genuinely flaky connection (gym wifi/
 * cellular signal). See retry.ts's retryOnTransientNetworkError, which uses
 * this to decide what's worth silently retrying — a real error (bad input,
 * a business rule the server rejected) never matches this and always
 * surfaces immediately instead.
 */
export function isTransientNetworkError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return NETWORK_ERROR_PATTERN.test(raw);
}

/**
 * Turns a caught error into a short, actionable Spanish message for an
 * Alert. Special-cases the transient network errors above — normal phone/
 * connectivity behavior, not an app bug, but the raw exception text
 * ("Error: fetch failed: UnexpectedException: The network connection was
 * lost. (at ExpoModulesCore/Promise.swift:56)") reads as a crash report,
 * not something a member can act on. Anything else falls through to the
 * error's own message, which for our own thrown `Error('mensaje en
 * español')` (every RPC wrapper in this codebase) is already a decent,
 * specific, Spanish message on its own.
 */
export function friendlyErrorMessage(err: unknown, fallback = 'Intenta de nuevo.'): string {
  if (isTransientNetworkError(err)) {
    return 'Se perdió la conexión a internet — puede pasar si sales de la app o se bloquea la pantalla justo mientras se guarda. Revisa tu conexión e intenta de nuevo.';
  }
  const raw = err instanceof Error ? err.message : String(err);
  return raw || fallback;
}
