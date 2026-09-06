import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import BrandLoader from "../components/common/BrandLoader";

/**
 * The full-screen loading gate that sits in front of a page until its first data
 * has arrived.
 *
 * A page declares "I have nothing to show yet" and the gate covers the viewport
 * with `BrandLoader` until that stops being true. Nothing here is timed: the gate
 * is driven entirely by the page's own loading flag, so a route whose data is
 * already warm opens with no loader at all and no added wait.
 *
 * Why a counter rather than a boolean: two components on a route can each be
 * waiting on a first load, and whichever finishes second must be the one that
 * lifts the gate. Increment on open, decrement on close, show while above zero.
 */
const RouteGateContext = createContext<((delta: number) => void) | null>(null);

export function RouteGateProvider({ children }: { children: ReactNode }) {
  const [waiting, setWaiting] = useState(0);

  const shift = useCallback((delta: number) => {
    setWaiting((n) => Math.max(0, n + delta));
  }, []);

  // Stable value: a new function identity here would re-run every consumer's
  // layout effect on each render of the provider.
  const value = useMemo(() => shift, [shift]);

  return (
    <RouteGateContext.Provider value={value}>
      {children}
      {waiting > 0 && <BrandLoader />}
    </RouteGateContext.Provider>
  );
}

/**
 * Holds the full-screen branded loader over the page while `active` is true.
 *
 * Pass the page's *first-load* flag — the one that is true only when there is
 * nothing on screen yet (`showSkeleton` from `useLoadingState`, or `loading &&
 * !data`). Passing a plain `loading` would also fire on in-place refreshes such
 * as a filter change, replacing that page's tidy dimmed-overlay refresh with a
 * whole-screen takeover.
 *
 * A layout effect, not an effect: it must register before the browser paints, or
 * the page's own skeleton flashes for a frame underneath the loader.
 *
 * Safe to call outside the provider — it simply does nothing, so a page rendered
 * in isolation (a test, a story) does not need the context.
 */
export function usePageGate(active: boolean): void {
  const shift = useContext(RouteGateContext);

  useLayoutEffect(() => {
    if (!shift || !active) return;

    shift(1);
    return () => shift(-1);
  }, [shift, active]);
}

export default RouteGateProvider;
