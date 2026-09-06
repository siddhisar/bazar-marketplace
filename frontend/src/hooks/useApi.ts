import { useCallback, useEffect, useRef, useState } from "react";

export type ApiState<T> = {
  data: T | null;
  /** True on the first load and on every refetch, so callers can show a skeleton. */
  loading: boolean;
  /** The server's own message when the request failed, else null. */
  error: string | null;
  /** Runs the request again, e.g. from a "Try again" button. */
  reload: () => void;
};

/**
 * Runs an API call and tracks loading, data and error for it.
 *
 * One place for the three states every page needs, so no page has to hand-roll
 * them and none of them can forget the error case.
 *
 * `deps` decides when to refetch — pass the values the request is built from
 * (an id, a query string) exactly as with useEffect. The fetcher itself is held
 * in a ref so an inline arrow function does not retrigger the effect on every
 * render.
 *
 * A response that arrives after the inputs changed is discarded rather than
 * applied: without that, a slow request for page 1 can land after a fast one
 * for page 2 and quietly replace the newer results.
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let current = true;

    setLoading(true);
    setError(null);

    fetcherRef
      .current()
      .then((result) => {
        if (!current) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (!current) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}
