/**
 * Server-side half of the post-login return path — see the frontend's
 * `lib/returnTo.ts` for the client-side counterpart. Kept independently
 * rather than shared code, since frontend and backend don't share a module
 * boundary here, but the rule must stay identical: this is what stands
 * between a `returnTo` (attacker-reachable as a query param on
 * GET /api/auth/google) and an open redirect out of the OAuth callback.
 */

/**
 * Whether a string is safe to store as this OAuth round trip's return path,
 * and safe to redirect to once it succeeds.
 *
 * Must be an internal, relative path — never a scheme or a protocol-relative
 * URL (`//evil.com`, which a browser also treats as "go to a different
 * origin"). Checked once on the way in (`getGoogleStart`, from a query
 * param) and again on the way out (`getGoogleCallback`, from the session) —
 * cheap, and it means neither call site can be safe only because it trusts
 * the other one still is.
 */
export function isSafeReturnPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/\\") &&
    !/[\x00-\x1f]/.test(path)
  );
}

/**
 * Adds `?auth=<marker>` (and `&reason=` if given) onto a return path,
 * preserving whatever query string it already carries — a bare string
 * concatenation would either clobber that query string or produce a
 * double `?`.
 */
export function withAuthMarker(
  path: string,
  marker: string,
  reason?: string,
): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("auth", marker);
  if (reason) params.set("reason", reason);
  return `${base}?${params.toString()}`;
}
