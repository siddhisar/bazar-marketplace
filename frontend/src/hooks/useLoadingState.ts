import { useEffect, useState } from "react";

/**
 * Only reports a load as "showing" once it has lasted long enough to be worth
 * showing.
 *
 * The point is to avoid flashing a spinner or overlay for a request that
 * resolves in 40ms — a loader that appears and vanishes faster than the eye
 * settles reads as a flicker, not as feedback. Below the delay the caller sees
 * `false` and simply shows its content; only a genuinely slow load crosses the
 * threshold and returns `true`.
 *
 * Crucially this delays the *loader*, never the content: the moment `active`
 * goes false this returns false on the same tick, so data is shown the instant
 * it arrives. There is no artificial hold on the real UI.
 *
 * Best suited to in-place refreshes (a re-filter, a page change) where existing
 * content stays visible underneath. A first load, with nothing to show yet,
 * should render a skeleton immediately rather than wait on this.
 */
export function useDelayedLoading(active: boolean, delayMs = 150): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }

    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return shown;
}

/**
 * Convenience wrapper returning the flags a page usually wants from one loading
 * boolean and whether it already holds data.
 *
 * - `showSkeleton`: a first load with nothing to show yet — render placeholders.
 * - `showOverlay`: a refresh over existing content, and slow enough to be worth
 *   marking — dim what is there and show an "updating" hint.
 *
 * Keeps the "skeleton vs overlay" decision in one place so pages do not each
 * re-derive it (and drift).
 */
export function useLoadingState(
  loading: boolean,
  hasData: boolean,
  delayMs = 150,
): { showSkeleton: boolean; showOverlay: boolean } {
  const slow = useDelayedLoading(loading, delayMs);
  return {
    showSkeleton: loading && !hasData,
    showOverlay: slow && hasData,
  };
}

export default useLoadingState;
