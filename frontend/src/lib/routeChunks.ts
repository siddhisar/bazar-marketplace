/**
 * The dynamic imports behind every code-split route, in one place.
 *
 * They live here rather than inline in `App.tsx` so the same importer can be used
 * twice: once by `React.lazy` to render the route, and once to fetch its chunk
 * ahead of time. The module specifier has to be identical for that to work —
 * the bundler keys its module cache on the specifier, which is what makes a
 * prefetch and the later real import resolve to one download rather than two.
 *
 * Prefetching matters more than it looks. React keeps the *previous* page on
 * screen while a lazy route's chunk is in flight, so a cold chunk reads as a
 * click that did nothing — measured at 1.7s on this app's search route. Fetching
 * it during idle time moves that cost off the click entirely.
 */
export const routeChunks = {
  home: () => import("../pages/Home/Home"),
  search: () => import("../pages/Search/SearchResults"),
  listing: () => import("../pages/Listing/ListingDetails"),
  category: () => import("../pages/Category/CategoryPage"),
  postAd: () => import("../pages/PostAd/PostAd"),
  myListings: () => import("../pages/MyListings/MyListings"),
  myOffers: () => import("../pages/MyOffers/MyOffers"),
  savedSearches: () => import("../pages/SavedSearches/SavedSearches"),
  savedListings: () => import("../pages/SavedListings/SavedListings"),
  login: () => import("../pages/Auth/Login"),
  register: () => import("../pages/Auth/Register"),
  profile: () => import("../pages/Profile/Profile"),
} as const;

export type RouteChunk = keyof typeof routeChunks;

/** Chunks already requested, so hovering a link repeatedly fetches once. */
const requested = new Set<RouteChunk>();

/**
 * Starts fetching a route's chunk if it has not been fetched already.
 *
 * Failures are swallowed on purpose: a prefetch is an optimisation, and a
 * offline blip here must not surface as an error. The real navigation will
 * attempt the import again and report the problem then, where it matters.
 */
export function prefetchRoute(name: RouteChunk): void {
  if (requested.has(name)) return;
  requested.add(name);
  void routeChunks[name]().catch(() => requested.delete(name));
}

/**
 * The routes worth having ready before they are asked for.
 *
 * Browsing is the common path through the site — someone lands, searches or
 * opens a category, then opens a listing — so those chunks earn their
 * bandwidth. "home" belongs here too: it is the landing page's own primary
 * button ("Browse marketplace"), not a secondary path, and leaving it out
 * meant that click paid for a chunk download it could have avoided entirely —
 * the one navigation this prefetch exists to make instant. The rest (posting,
 * auth) stay on demand rather than being pulled down for every visitor who
 * will never sign in.
 */
const LIKELY_NEXT: RouteChunk[] = ["home", "search", "listing"];

/**
 * Warms the likely-next chunks once the browser is otherwise idle.
 *
 * `requestIdleCallback` keeps this behind anything the current page still wants
 * to do, so it cannot compete with the first screen's own data or images. Where
 * it is unavailable (Safari), a timeout stands in.
 *
 * @returns a cleanup function that cancels the pending callback.
 */
export function prefetchLikelyRoutes(): () => void {
  const run = () => LIKELY_NEXT.forEach(prefetchRoute);

  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 2_000 });
    return () => cancelIdleCallback(id);
  }

  const id = window.setTimeout(run, 1_000);
  return () => window.clearTimeout(id);
}
