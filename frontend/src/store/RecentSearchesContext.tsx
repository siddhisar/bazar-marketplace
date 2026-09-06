import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../lib/storage";

export type RecentSearch = {
  /** What was typed, exactly as typed. */
  query: string;
  /** When it was last run — a repeat moves an entry back to the top. */
  at: string;
};

type RecentSearchesValue = {
  /** Most recent first. */
  recent: RecentSearch[];
  /** Records a query that was actually run. Blank queries are ignored. */
  record: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
};

/** Enough to be useful, few enough to fit under the box without scrolling. */
const MAX_RECENT = 8;

const RecentSearchesContext = createContext<RecentSearchesValue | null>(null);

/**
 * The searches this browser has run, newest first.
 *
 * Kept on the device rather than the server. It is a convenience tied to where
 * someone types, needs no account (browsing is anonymous by design), and putting
 * it in the database would mean writing a row on every search — the one request
 * on this site that has to stay fast.
 *
 * Deliberately separate from saved searches: this list is automatic and
 * disposable, whereas a saved search is deliberate, named, and carries its
 * filters. Conflating them would mean every idle query cluttering the list a
 * person curated.
 */
export function RecentSearchesProvider({ children }: { children: ReactNode }) {
  const [recent, setRecent] = useState<RecentSearch[]>(() =>
    loadJSON<RecentSearch[]>(STORAGE_KEYS.recentSearches, []),
  );

  useEffect(() => {
    saveJSON(STORAGE_KEYS.recentSearches, recent);
  }, [recent]);

  const record = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setRecent((current) => {
      /* Compared case-insensitively so "iPhone" and "iphone" are one entry, but
         the newly typed spelling is what gets stored — the list should read back
         the way the person last wrote it. Dropping the old entry and unshifting
         is what makes a repeat search move to the top rather than duplicate. */
      const withoutDuplicate = current.filter(
        (entry) => entry.query.toLowerCase() !== trimmed.toLowerCase(),
      );

      return [
        { query: trimmed, at: new Date().toISOString() },
        ...withoutDuplicate,
      ].slice(0, MAX_RECENT);
    });
  }, []);

  const remove = useCallback((query: string) => {
    setRecent((current) =>
      current.filter(
        (entry) => entry.query.toLowerCase() !== query.toLowerCase(),
      ),
    );
  }, []);

  const clear = useCallback(() => setRecent([]), []);

  const value = useMemo<RecentSearchesValue>(
    () => ({ recent, record, remove, clear }),
    [recent, record, remove, clear],
  );

  return (
    <RecentSearchesContext.Provider value={value}>
      {children}
    </RecentSearchesContext.Provider>
  );
}

export function useRecentSearches(): RecentSearchesValue {
  const context = useContext(RecentSearchesContext);
  if (!context) {
    throw new Error(
      "useRecentSearches must be used within a RecentSearchesProvider",
    );
  }
  return context;
}
