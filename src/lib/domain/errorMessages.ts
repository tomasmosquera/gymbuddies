/**
 * Turns a caught error into a short, actionable Spanish message for an
 * Alert. Special-cases iOS's NSURLErrorDomain -1005 ("The network
 * connection was lost") — fires whenever the app backgrounds, the screen
 * locks, or the network hands off (wifi <-> cellular) while a request is in
 * flight (see storage.ts's own doc comment on why uploads use a BACKGROUND
 * URLSession specifically to survive it; a plain fetch/RPC call has no such
 * protection). This is normal phone behavior, not an app bug — the raw
 * exception text ("Error: fetch failed: UnexpectedException: The network
 * connection was lost. (at ExpoModulesCore/Promise.swift:56)") reads as a
 * crash report, not something a member can act on. Anything else falls
 * through to the error's own message, which for our own thrown
 * `Error('mensaje en español')` (every RPC wrapper in this codebase) is
 * already a decent, specific, Spanish message on its own.
 */
export function friendlyErrorMessage(err: unknown, fallback = 'Intenta de nuevo.'): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/network connection was lost|network request failed|internet connection appears to be offline/i.test(raw)) {
    return 'Se perdió la conexión a internet — puede pasar si sales de la app o se bloquea la pantalla justo mientras se guarda. Revisa tu conexión e intenta de nuevo.';
  }
  return raw || fallback;
}
