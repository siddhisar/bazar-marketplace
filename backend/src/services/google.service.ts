/**
 * Google OAuth 2.0 authorisation-code flow, implemented directly against
 * Google's endpoints.
 *
 * Done by hand rather than with passport because the flow is three requests and
 * the brief cares that the exchange is understood: build an authorise URL, swap
 * the returned code for tokens, then read the profile.
 *
 * Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Without them
 * `isGoogleConfigured()` is false and the routes report that rather than
 * pretending to work.
 */
import { config } from "../config/env";

const AUTHORISE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function isGoogleConfigured(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

/**
 * The URL to send the browser to. `state` is generated per attempt and checked
 * on return, which is what stops a third party from feeding us a code of their
 * own choosing (CSRF on the callback).
 */
export function buildAuthoriseUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleCallbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    // Ask for the account chooser every time rather than silently reusing the
    // one Google session the browser happens to hold.
    prompt: "select_account",
  });
  return `${AUTHORISE_URL}?${params.toString()}`;
}

export type GoogleProfile = {
  providerUserId: string;
  email: string;
  name: string;
};

/**
 * Carries Google's own short error code (`invalid_client`, `invalid_grant`,
 * `redirect_uri_mismatch`, ...) separately from the human-readable message,
 * so the callback controller can pass just the code on to the client without
 * also forwarding whatever verbose description came with it.
 */
export class GoogleAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/**
 * Exchanges an authorisation code for the user's profile. This is the
 * "server-to-server" half of Google sign-in that never touches the browser —
 * it happens entirely between this backend and Google's servers, using the
 * temporary `code` Google gave the browser in the callback redirect.
 *
 * Two HTTP requests happen here, one after the other with `await` so each
 * finishes before the next starts:
 *   1. POST to Google's token endpoint: trade the one-time `code` (plus this
 *      app's secret `client_id`/`client_secret`, proving it's really this
 *      app asking) for an `access_token` — a temporary key that can be used
 *      to ask Google questions on this person's behalf.
 *   2. GET Google's "userinfo" endpoint using that access token, which
 *      returns the person's email, name, and Google account ID.
 *
 * Throws when Google rejects the exchange or the account has no verified email:
 * an unverified address could be someone else's, and linking on it would hand
 * over an existing account.
 */
export async function fetchGoogleProfile(code: string): Promise<GoogleProfile> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleCallbackUrl,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    // Google's own body names the real reason (invalid_client, invalid_grant,
    // redirect_uri_mismatch, ...) — the status code alone was leaving this
    // completely unguessable from the server log, and from the sign-in
    // attempt itself: there was previously no way to see *why* without
    // reading a server log by hand.
    const body = await tokenResponse.text().catch(() => "");
    let code = "unknown_error";
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) code = parsed.error;
    } catch {
      // Not JSON — keep the generic code, the full body is still in the message.
    }
    throw new GoogleAuthError(
      code,
      `Google token exchange failed (${tokenResponse.status}): ${body}`,
    );
  }

  // Object destructuring, with renaming: this pulls the `access_token` field
  // out of Google's JSON response and stores it in a variable called
  // `accessToken` (matching this project's naming style) in one step,
  // instead of writing `const accessToken = response.access_token`.
  const { access_token: accessToken } = (await tokenResponse.json()) as {
    access_token?: string;
  };
  if (!accessToken) throw new Error("Google token response had no access_token");

  const profileResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileResponse.ok) {
    throw new Error(`Google userinfo failed (${profileResponse.status})`);
  }

  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (!profile.sub || !profile.email) {
    throw new Error("Google profile was missing sub or email");
  }
  if (profile.email_verified === false) {
    throw new Error("Google account email is not verified");
  }

  return {
    providerUserId: profile.sub,
    email: profile.email,
    // Google omits `name` on some accounts; fall back to the local part.
    name: profile.name?.trim() || profile.email.split("@")[0],
  };
}
