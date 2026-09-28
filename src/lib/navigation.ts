import { router } from 'expo-router';

type Href = Parameters<typeof router.push>[0];

/**
 * replace() this screen with `sameTabHref` (a route in this screen's OWN
 * tab) before push()-ing into `crossTabHref` (a route in a DIFFERENT tab).
 * The replace cleans this screen out of its own tab's history so it can
 * never be revisited later via the back gesture/button or by switching
 * back to this tab — left dangling there instead, a screen whose data is
 * now stale (e.g. a finished workout session) can get stuck on its own
 * loading state forever once revisited (observed in both
 * workout-session.tsx's Terminar → checkout jump and routine-choice.tsx's
 * own jump into a live session).
 *
 * The two calls are NOT dispatched back to back: doing that once silently
 * dropped the push entirely (the replace's own navigation-state update
 * hadn't committed yet). A short delay lets it settle first.
 */
export function replaceThenCrossTabPush(sameTabHref: Href, crossTabHref: Href) {
  router.replace(sameTabHref);
  setTimeout(() => router.push(crossTabHref), 50);
}
