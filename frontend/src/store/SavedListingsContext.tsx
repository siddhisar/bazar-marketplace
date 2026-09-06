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
  fetchSavedListingIds,
  saveListing,
  unsaveListing,
} from "../lib/api";
import { useAuth } from "./AuthContext";
import { useConfirm } from "./ConfirmContext";
import { currentReturnPath } from "../lib/returnTo";

/**
 * The one listing a signed-out Like was attempting, so it can complete
 * itself once sign-in succeeds instead of just landing back on the same page
 * and making the visitor click Like again. sessionStorage rather than
 * component state: it has to survive the Google OAuth round trip, which
 * leaves the SPA (and every in-memory value with it) entirely and comes back
 * as a fresh page load — same reasoning as `returnTo` itself, see
 * lib/returnTo.ts. Session-scoped rather than localStorage, since a
 * half-finished "like this" intent has no reason to outlive the tab it was
 * started in.
 */
const PENDING_LIKE_KEY = "bazaar:pendingLike";

/**
 * How long a pending Like is honoured after the prompt that created it — long
 * enough to cover an actual login (typing a password, or the round trip
 * through Google), short enough that an abandoned attempt (login page closed,
 * never finished) cannot resurface and silently toggle a listing on some much
 * later, unrelated sign-in.
 */
const PENDING_LIKE_MAX_AGE_MS = 10 * 60 * 1000;

type PendingLike = { id: string; at: number };

function readPendingLike(): string | null {
  const raw = sessionStorage.getItem(PENDING_LIKE_KEY);
  sessionStorage.removeItem(PENDING_LIKE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingLike;
    if (typeof parsed.id !== "string" || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > PENDING_LIKE_MAX_AGE_MS) return null;
    return parsed.id;
  } catch {
    return null;
  }
}

/** Only the ids are stored — the listing itself is looked up from the API. */
type SavedListingsValue = {
  ids: string[];
  count: number;
  isSaved: (id: string) => boolean;
  /** Saves or unsaves. Prompts login when signed out; nothing is stored. */
  toggle: (id: string) => void;
  remove: (id: string) => void;
};

const SavedListingsContext = createContext<SavedListingsValue | null>(null);

/**
 * Listings the signed-in user has saved (the wishlist).
 *
 * The database is the source of truth: the ids are fetched when a user logs in
 * and re-fetched whenever the account changes, which is what makes a wishlist
 * saved in one browser appear when the same account logs in anywhere else. Local
 * state is only a cache for instant heart toggles.
 *
 * Nothing is saved for a logged-out visitor. There is no anonymous wishlist in
 * localStorage — a save attempt while signed out opens the login prompt instead,
 * so no saved data is ever created without an account behind it.
 */
export function SavedListingsProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();

  /** A Set for O(1) lookup. Empty whenever no one is signed in. */
  const [ids, setIds] = useState<Set<string>>(new Set());

  /* Load this user's saved ids on login, and clear them on logout so the next
     visitor never inherits the last one's wishlist. Keyed on the user id, so
     switching accounts refetches rather than showing the previous account's. */
  useEffect(() => {
    if (!user) {
      setIds(new Set());
      return;
    }

    let live = true;
    fetchSavedListingIds()
      .then((list) => {
        if (live) setIds(new Set(list));
      })
      .catch(() => {
        // A failed load leaves the wishlist empty rather than crashing the app;
        // the next toggle will surface any real problem.
        if (live) setIds(new Set());
      });

    return () => {
      live = false;
    };
  }, [user]);

  /** The actual save/unsave — no auth check, so the pending-like resume below can call it directly once signed in. */
  const applyToggle = useCallback((id: string) => {
    setIds((current) => {
      const wasSaved = current.has(id);
      const next = new Set(current);
      if (wasSaved) next.delete(id);
      else next.add(id);

      const request = wasSaved ? unsaveListing(id) : saveListing(id);
      request.catch(() => {
        setIds((rollback) => {
          const reverted = new Set(rollback);
          if (wasSaved) reverted.add(id);
          else reverted.delete(id);
          return reverted;
        });
      });

      return next;
    });
  }, []);

  /* Resumes a Like that was interrupted by a login prompt, the moment sign-in
     completes — so "Like -> log in -> back on the listing" finishes the Like
     rather than leaving the visitor to click it again. Keyed on `user` (fires
     right after it flips from null to set), not on mount, since that is the
     one moment this can legitimately apply. */
  useEffect(() => {
    if (!user) return;
    const pendingId = readPendingLike();
    if (pendingId) applyToggle(pendingId);
  }, [user, applyToggle]);

  /** Opens the login prompt, remembering both where to return to and which listing to finish liking. */
  const promptLogin = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Log in to save listings",
        message:
          "Saving keeps listings to your account so you can find them on any device. It only takes a moment.",
        confirmLabel: "Log in",
        cancelLabel: "Not now",
      });
      if (!ok) return;

      sessionStorage.setItem(
        PENDING_LIKE_KEY,
        JSON.stringify({ id, at: Date.now() } satisfies PendingLike),
      );
      navigate("/login", { state: { from: currentReturnPath(location) } });
    },
    [confirm, navigate, location],
  );

  const toggle = useCallback(
    (id: string) => {
      // While the initial /me check is in flight, a signed-in visitor cannot
      // yet be told apart from a signed-out one — better to do nothing for
      // that brief moment than to wrongly demand login from someone already
      // signed in (which this same fix would then, ironically, "resolve" by
      // sending them right back to a page they were already on).
      if (loading) return;

      if (!user) {
        void promptLogin(id);
        return;
      }

      applyToggle(id);
    },
    [user, loading, promptLogin, applyToggle],
  );

  const remove = useCallback(
    (id: string) => {
      if (!user || !ids.has(id)) return;

      setIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      unsaveListing(id).catch(() => {
        setIds((current) => new Set(current).add(id));
      });
    },
    [user, ids],
  );

  const value = useMemo<SavedListingsValue>(
    () => ({
      ids: [...ids],
      count: ids.size,
      isSaved: (id) => ids.has(id),
      toggle,
      remove,
    }),
    [ids, toggle, remove],
  );

  return (
    <SavedListingsContext.Provider value={value}>
      {children}
    </SavedListingsContext.Provider>
  );
}

export function useSavedListings(): SavedListingsValue {
  const context = useContext(SavedListingsContext);
  if (!context) {
    throw new Error(
      "useSavedListings must be used within a SavedListingsProvider",
    );
  }
  return context;
}
