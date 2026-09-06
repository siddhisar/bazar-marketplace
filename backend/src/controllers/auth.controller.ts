/**
 * This file handles everything about proving who someone is: email/password
 * login and registration, logging out, checking who's currently logged in,
 * and signing in with Google.
 *
 * How login/registration works, step by step:
 *   1. React sends { email, password } to POST /api/auth/login (or /register).
 *   2. This file validates the shape of that data, then asks
 *      services/auth.service.ts to check the password (login) or create the
 *      account (register) — the actual password hashing and comparison
 *      happens there, never in this file.
 *   3. On success, `startSession()` below creates a session — a way for the
 *      server to remember "this browser is now logged in as user #42" across
 *      future requests, using a cookie (see middleware/session.middleware.ts
 *      for how that cookie is configured).
 *   4. The response tells React who's logged in; React stores that in
 *      AuthContext so the rest of the app knows.
 *
 * How Google sign-in works, step by step (the getGoogleStart /
 * getGoogleCallback pair below):
 *   1. User clicks "Continue with Google" -> browser is sent to
 *      GET /api/auth/google (getGoogleStart), which redirects the whole
 *      browser tab to Google's own sign-in page.
 *   2. The person signs in on Google's site, not this app's — this app never
 *      sees their Google password.
 *   3. Google redirects the browser back to
 *      GET /api/auth/google/callback (getGoogleCallback) with a temporary
 *      code proving the sign-in happened.
 *   4. This server exchanges that code with Google directly (server-to-server,
 *      see services/google.service.ts) for the person's email and name.
 *   5. A user account is found or created for that email, a session is
 *      started exactly like a normal login, and the browser is redirected
 *      back into the React app — now logged in.
 *
 * The `state` value used in steps 1 and 3 is a security check (explained
 * further down at getGoogleStart) that stops a stranger from tricking someone
 * into completing someone else's login.
 *
 * `returnTo` rides alongside `state` the same way: the frontend passes the
 * page it wants back (e.g. `/listing/123`) as a query param on step 1,
 * getGoogleStart saves it in the session next to the CSRF state, and
 * getGoogleCallback reads it back out to redirect somewhere other than the
 * homepage once sign-in succeeds. It has to travel through the *session*
 * rather than as a query param Google echoes back — Google's own redirect
 * URI is fixed and only carries `code`/`state`, nothing this app adds.
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config/env";
import { AuthError, login, register, signInWithGoogle } from "../services/auth.service";
import {
  buildAuthoriseUrl,
  fetchGoogleProfile,
  GoogleAuthError,
  isGoogleConfigured,
} from "../services/google.service";
import { findUserById } from "../repositories/user.repository";
import { parseCredentials, parseRegistration } from "../validators/auth.validator";
import { sendError, sendSuccess } from "../utils/response";
import { isSafeReturnPath, withAuthMarker } from "../utils/returnTo";

/**
 * Starts a fresh session for a user id — this is what actually "logs someone
 * in" at the server level.
 *
 * A session is a small piece of data stored on the server (in the
 * `user_sessions` database table here) and identified by a random ID that
 * gets sent to the browser as a cookie. On every later request, the browser
 * automatically sends that cookie back, and the server looks up the session
 * to know who's asking — that's how the app "remembers" a logged-in user
 * without them re-entering a password on every page.
 *
 * This function wraps two callback-based operations
 * (`req.session.regenerate`, `req.session.save`) in a `Promise`, so the
 * calling code can simply `await startSession(...)` instead of nesting
 * callbacks inside callbacks.
 *
 * The session is regenerated on every successful sign-in so the pre-login
 * session identifier cannot be reused afterwards (session fixation).
 */
function startSession(req: Request, userId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.userId = userId;
      req.session.save((saveError) =>
        saveError ? reject(saveError) : resolve(),
      );
    });
  });
}

/** POST /api/auth/register */
export async function postRegister(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = parseRegistration(req.body);
    if ("error" in parsed) {
      sendError(res, 400, parsed.error);
      return;
    }

    const user = await register(parsed.value);
    await startSession(req, user.id);
    sendSuccess(res, user, 201);
  } catch (err) {
    if (err instanceof AuthError) {
      sendError(res, err.status, err.message);
      return;
    }
    next(err);
  }
}

/** POST /api/auth/login */
export async function postLogin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = parseCredentials(req.body);
    if ("error" in parsed) {
      sendError(res, 400, parsed.error);
      return;
    }

    const user = await login(parsed.value);
    await startSession(req, user.id);
    sendSuccess(res, user);
  } catch (err) {
    if (err instanceof AuthError) {
      sendError(res, err.status, err.message);
      return;
    }
    next(err);
  }
}

/**
 * POST /api/auth/logout
 *
 * Destroys the session server-side as well as clearing the cookie, so a copied
 * cookie is useless afterwards — clearing the cookie alone would leave the
 * session row valid.
 */
export function postLogout(req: Request, res: Response, next: NextFunction): void {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("bazaar.sid");
    sendSuccess(res, { loggedOut: true });
  });
}

/**
 * GET /api/auth/me
 *
 * Returns the signed-in user or null. Null is a 200, not a 401: "nobody is
 * signed in" is a normal answer for the page load that asks this.
 */
export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.session.userId;
    if (!userId) {
      sendSuccess(res, null);
      return;
    }

    const user = await findUserById(userId);
    if (!user) {
      // The account was deleted while the session lived on.
      req.session.destroy(() => undefined);
      sendSuccess(res, null);
      return;
    }

    sendSuccess(res, {
      id: user.id,
      email: user.email,
      name: user.display_name,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/google — the first step of Google sign-in: send the browser
 * to Google's own consent screen.
 *
 * `state` is a random, one-time value used to prevent a specific attack:
 * without it, an attacker could start their own Google sign-in, capture the
 * callback link Google generates, and trick a victim into opening it — which
 * would log the victim into the attacker's account. By generating a random
 * value here, saving it in this browser's session, and checking (in
 * getGoogleCallback below) that the value Google sends back matches, the
 * server can be sure the person completing the callback is the same person
 * who started it in this exact browser.
 */
export function getGoogleStart(req: Request, res: Response): void {
  if (!isGoogleConfigured()) {
    sendError(
      res,
      503,
      "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
    return;
  }

  // Held in the session so the value returned by Google can be compared to the
  // one this browser was actually issued.
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  // Where to send the browser back to once sign-in succeeds — validated here
  // (an attacker-controlled query param) rather than trusted purely because
  // it made it into the session; see getGoogleCallback, which validates it
  // again on the way out for the same reason.
  const returnTo = req.query.returnTo;
  req.session.returnTo = isSafeReturnPath(returnTo) ? returnTo : undefined;

  req.session.save(() => res.redirect(buildAuthoriseUrl(state)));
}

/**
 * GET /api/auth/google/callback
 *
 * Google sends the browser here, so the responses are redirects back into the
 * frontend rather than JSON — with ?auth=google_failed on failure so the UI can
 * say something useful.
 */
export async function getGoogleCallback(
  req: Request,
  res: Response,
): Promise<void> {
  // `detail` is Google's own short error code (invalid_client, invalid_grant,
  // ...) — safe to hand to the client since it's a fixed OAuth error keyword,
  // never a stack trace or anything else that could leak internals.
  const fail = (reason: string, detail?: string) =>
    res.redirect(
      `${config.clientUrl}/?auth=${encodeURIComponent(reason)}` +
        (detail ? `&reason=${encodeURIComponent(detail)}` : ""),
    );

  if (!isGoogleConfigured()) return fail("google_unconfigured");

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const expectedState = req.session.oauthState;
  const returnTo = req.session.returnTo;

  // Consume both either way, so neither can be replayed on a later attempt.
  req.session.oauthState = undefined;
  req.session.returnTo = undefined;

  if (req.query.error) return fail("google_denied");
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("google_state_mismatch");
  }

  try {
    const profile = await fetchGoogleProfile(code);
    const user = await signInWithGoogle(profile);
    await startSession(req, user.id);
    // Back to wherever sign-in was started from — a listing, a search, a
    // gated page — rather than the homepage regardless of that. Falls back to
    // the main browsing page (not the logged-out Welcome screen: that page's
    // whole point is "log in or create an account", which someone who just
    // did either doesn't need to see) only when no return path was captured,
    // e.g. sign-in started directly from /login with no prior page to return to.
    // Re-validated here even though getGoogleStart already checked it once —
    // this is the value that actually goes into a redirect, so it must not
    // depend on that earlier check alone having been correct.
    const destination = isSafeReturnPath(returnTo) ? returnTo : "/home";
    res.redirect(`${config.clientUrl}${withAuthMarker(destination, "google_ok")}`);
  } catch (err) {
    console.error("[auth] Google sign-in failed:", (err as Error).message);
    fail("google_failed", err instanceof GoogleAuthError ? err.code : undefined);
  }
}

/** GET /api/auth/providers — lets the UI hide a button that cannot work. */
export function getAuthProviders(_req: Request, res: Response): void {
  sendSuccess(res, { google: isGoogleConfigured() });
}
