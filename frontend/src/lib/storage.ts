/**
 * Small wrappers around localStorage.
 *
 * Everything is wrapped in try/catch: storage throws in private browsing modes
 * and when the quota is full, and a saved listing failing to persist must never
 * take the page down with it.
 */

/** Versioned, so a change of shape can be ignored rather than crash on read. */
export const STORAGE_KEYS = {
  /* Saved listings and saved searches used to live here, per-browser. They are
     now stored in the database against the user account, so they persist across
     browsers and devices and never exist for a logged-out visitor. Only the
     recent-search history remains local: it is a device convenience, not a saved
     record, and needs no account. */
  recentSearches: "bazaar.recent-searches.v1",
} as const;

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing useful to do — the feature degrades to "not remembered".
  }
}
