import { router } from 'expo-router';

type Href = Parameters<typeof router.push>[0];

/**
 * replace() this screen with `sameTabHref` (a route in this screen's OWN
 * tab) before navigate()-ing into `crossTabHref` (a route in a DIFFERENT
 * tab). The replace cleans this screen out of its own tab's history so it
 * can never be revisited later via the back gesture/button or by switching
 * back to this tab — left dangling there instead, a screen whose data is
 * now stale (e.g. a finished workout session) can get stuck on its own
 * loading state forever once revisited (observed in both
 * workout-session.tsx's Terminar → checkout jump and routine-choice.tsx's
 * own jump into a live session).
 *
 * navigate(), not push(): a member doing check-in → start a routine →
 * Terminar round-trips through BOTH tabs this helper touches, and replace()
 * only ever swaps the top of a stack — it never collapses what's under it.
 * push()-ing crossTabHref on every round trip kept adding another instance
 * of it on top of whatever was already there from the previous round trip,
 * so by the second check-in-with-a-routine in a row the checkin tab was 3-4
 * screens deep with duplicate `index` entries, one of them underneath a
 * fullScreenModal (checkin/preview). That depth is what turned a later,
 * otherwise-routine cross-tab replace() (preview.tsx's own jump to /home
 * after the checkout photo) into a frozen black screen — the SAME replace()
 * works fine from the shallow 2-deep stack a plain checkout (no routine)
 * leaves behind. navigate() reuses crossTabHref's existing screen instead of
 * stacking a new one when it's already present, keeping depth from growing
 * no matter how many times this helper fires.
 *
 * The two calls are NOT dispatched back to back: doing that once silently
 * dropped the navigate (the replace's own navigation-state update hadn't
 * committed yet). A short delay lets it settle first.
 */
export function replaceThenCrossTabNavigate(sameTabHref: Href, crossTabHref: Href) {
  router.replace(sameTabHref);
  setTimeout(() => router.navigate(crossTabHref), 50);
}
