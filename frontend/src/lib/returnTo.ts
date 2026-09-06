/**
 * Where to send someone back to after they log in — computed from wherever
 * they were when a protected action or page asked them to sign in first, so
 * "log in" never simply dumps them on the homepage instead of what they were
 * doing.
 *
 * Every place that captures or consumes this value routes through here, so
 * there is exactly one definition of "safe" to keep in sync — see
 * `isSafeReturnPath`.
 */

/**
 * Whether a string is safe to hand to `navigate()` (or store for the Google
 * OAuth round trip) as a post-login return path.
 *
 * Must be an internal, relative path — never a scheme (`https://evil.com`) or
 * a protocol-relative URL (`//evil.com`, which the browser also treats as
 * "go to a different origin"). Without this check, a `from`/`returnTo` value
 * — reachable via React Router state today, and via a `?returnTo=` query
 * param for the Google flow — could turn the login page into an open
 * redirect to anywhere.
 */
export function isSafeReturnPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/\\") &&
    // Control characters (e.g. a tab) let some URL parsers smuggle a scheme
    // past a naive startsWith("/") check.
    !/[\x00-\x1f]/.test(path)
  );
}

/** The full path a `location` describes — including the query string, so search filters, sort and page survive the round trip. */
export function currentReturnPath(location: { pathname: string; search: string }): string {
  return location.pathname + location.search;
}
