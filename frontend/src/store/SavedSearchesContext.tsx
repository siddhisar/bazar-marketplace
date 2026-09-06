import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  createSavedSearch,
  deleteSavedSearch,
  fetchSavedSearches,
  markSavedSearchViewed,
  type ApiSavedSearch,
} from "../lib/api";
import { paramsFromSearch } from "../lib/search";
import { searchListingsViaApi } from "../lib/searchApi";
import { useAuth } from "./AuthContext";
import { useConfirm } from "./ConfirmContext";
import { currentReturnPath } from "../lib/returnTo";

/** A saved search, exactly as the API returns it. */
export type SavedSearch = ApiSavedSearch;

type SavedSearchesValue = {
  searches: SavedSearch[];
  /** Resolves `true` once actually saved — `false` when signed out (a login prompt was shown instead) or cancelled, so the caller can tell a real save apart from either. */
  save: (name: string, query: string) => Promise<boolean>;
  remove: (id: string) => void;
  /** New matches since last checked — the "3 new listings" badge. */
  newCount: (search: SavedSearch) => number;
  /** Resets the badge; called when the saved search is opened. */
  markChecked: (id: string) => Promise<void>;
};

const SavedSearchesContext = createContext<SavedSearchesValue | null>(null);

/**
 * How many results a saved search returns right now.
 *
 * Goes through the same bridge the results page uses rather than a bespoke count
 * query, so "new matches" is counted by exactly the rules that decide what the
 * page will show — a count derived differently from the listing it points at is
 * worse than no count at all.
 *
 * @returns the total, or null when the request fails (treated as "unknown",
 *          i.e. nothing new, rather than inventing a number).
 */
async function currentTotal(query: string): Promise<number | null> {
  try {
    const result = await searchListingsViaApi(
      paramsFromSearch(new URLSearchParams(query)),
    );
    return result.total;
  } catch {
    return null;
  }
}

/**
 * Searches the signed-in user has saved, with a count of what has appeared since.
 *
 * The database is the source of truth: the list is fetched on login and re-fetched
 * when the account changes, so a search saved in one browser shows up when the
 * same account logs in anywhere. `seen_count` is stored on each row server-side,
 * so the "N new" badge is correct across devices too — not just on the browser
 * that saved it.
 *
 * Nothing is stored for a logged-out visitor: `save` opens the login prompt.
 */
export function SavedSearchesProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();

  const [searches, setSearches] = useState<SavedSearch[]>([]);
  /** Live totals by saved-search id, as last fetched — drives the badge. */
  const [totals, setTotals] = useState<Record<string, number>>({});

  /* Load on login, clear on logout so the next visitor never sees the last
     user's saved searches. */
  useEffect(() => {
    if (!user) {
      setSearches([]);
      setTotals({});
      return;
    }

    let live = true;
    fetchSavedSearches()
      .then((list) => {
        if (live) setSearches(list);
      })
      .catch(() => {
        if (live) setSearches([]);
      });

    return () => {
      live = false;
    };
  }, [user]);

  /* Refresh each saved search's current total when the set changes, so the badge
     reflects what exists now. Keyed on ids+queries, not array identity, so a
     re-render does not refetch. */
  const fingerprint = searches.map((entry) => `${entry.id}:${entry.query}`).join("|");

  useEffect(() => {
    let live = true;
    if (searches.length === 0) return;

    void Promise.all(
      searches.map(async (entry) => [entry.id, await currentTotal(entry.query)] as const),
    ).then((pairs) => {
      if (!live) return;
      setTotals((current) => {
        const next = { ...current };
        for (const [id, total] of pairs) if (total !== null) next[id] = total;
        return next;
      });
    });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  const promptLogin = useCallback(async () => {
    const ok = await confirm({
      title: "Log in to save searches",
      message:
        "Saving a search keeps it to your account and tells you when new matching listings appear. It only takes a moment.",
      confirmLabel: "Log in",
      cancelLabel: "Not now",
    });
    if (ok) navigate("/login", { state: { from: currentReturnPath(location) } });
  }, [confirm, navigate, location]);

  const save = useCallback(
    async (name: string, query: string): Promise<boolean> => {
      // Same brief-window reasoning as SavedListingsContext.toggle: don't
      // decide "not signed in" off a still-loading auth check.
      if (loading) return false;

      if (!user) {
        await promptLogin();
        return false;
      }

      // Baseline is what exists now, so the badge starts at zero rather than
      // announcing every existing listing as new.
      const total = (await currentTotal(query)) ?? 0;
      const row = await createSavedSearch({ name, query, seenCount: total });

      setSearches((current) => [row, ...current]);
      setTotals((current) => ({ ...current, [row.id]: total }));
      return true;
    },
    [user, loading, promptLogin],
  );

  const remove = useCallback((id: string) => {
    // Optimistic removal, rolled back if the server refuses.
    let removed: SavedSearch | undefined;
    setSearches((current) => {
      removed = current.find((entry) => entry.id === id);
      return current.filter((entry) => entry.id !== id);
    });

    deleteSavedSearch(id).catch(() => {
      if (removed) setSearches((current) => [removed as SavedSearch, ...current]);
    });
  }, []);

  const markChecked = useCallback(async (id: string) => {
    const total = (await currentTotal(
      searches.find((entry) => entry.id === id)?.query ?? "",
    )) ?? 0;

    // Persist the new baseline so the badge stays cleared on other devices too,
    // then reflect it locally.
    void markSavedSearchViewed(id, total).catch(() => undefined);
    setSearches((current) =>
      current.map((entry) =>
        entry.id === id
          ? { ...entry, lastCheckedAt: new Date().toISOString(), seenCount: total }
          : entry,
      ),
    );
    setTotals((current) => ({ ...current, [id]: total }));
  }, [searches]);

  const value = useMemo<SavedSearchesValue>(
    () => ({
      searches,
      save,
      remove,
      markChecked,
      // Clamped at zero: listings expire and sell, so the total can fall below
      // the baseline, and "-2 new listings" is not a thing.
      newCount: (search) =>
        Math.max(0, (totals[search.id] ?? search.seenCount) - search.seenCount),
    }),
    [searches, save, remove, markChecked, totals],
  );

  return (
    <SavedSearchesContext.Provider value={value}>
      {children}
    </SavedSearchesContext.Provider>
  );
}

export function useSavedSearches(): SavedSearchesValue {
  const context = useContext(SavedSearchesContext);
  if (!context) {
    throw new Error(
      "useSavedSearches must be used within a SavedSearchesProvider",
    );
  }
  return context;
}
