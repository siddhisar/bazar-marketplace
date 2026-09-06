/**
 * This file configures how login sessions and their cookies work — it's
 * plugged into the app once, in app.ts, and after that every request
 * automatically has `req.session` available to read and write.
 *
 * Session setup. Sessions live in Postgres rather than in memory, so they
 * survive a server restart and a logout can actually delete one — an in-memory
 * store would drop every login on each `tsx watch` reload.
 */
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";
import { config } from "../config/env";
import { getPool } from "../config/database";

/** Fields this app stores on a session. */
declare module "express-session" {
  interface SessionData {
    userId?: number;
    /** Anti-CSRF value for an in-flight OAuth round trip. */
    oauthState?: string;
    /** Where to send the browser back to once that OAuth round trip succeeds — see getGoogleStart/getGoogleCallback. */
    returnTo?: string;
  }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function buildSessionMiddleware(): RequestHandler {
  const PgStore = connectPgSimple(session);

  return session({
    name: "bazaar.sid",
    secret: config.sessionSecret,
    store: new PgStore({
      /* Share the app's pool rather than handing the store a connection string.
         Given one, connect-pg-simple builds a second pool of its own — unwarmed,
         and separate from the one startup pre-opens — so a session read on an
         otherwise idle server paid a fresh TLS handshake to the database. That
         put seconds onto requests whose own query took milliseconds. Sessions
         are touched on nearly every request, so this is the pool that most
         needed to be warm. */
      pool: getPool(),
      tableName: "user_sessions",
      // Created by the migration; this only guards a fresh database.
      createTableIfMissing: true,
      // Sweep expired rows periodically so the table does not grow forever.
      pruneSessionInterval: 60 * 15,
    }),
    // Nothing is stored against anonymous visitors, so there is no reason to
    // write a row (or set a cookie) until something is actually kept.
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true, // unreadable from JavaScript, so XSS cannot lift it
      /* "Lax" survives the Google *redirect* back to us (a top-level
         navigation), but the frontend and API are on two different
         registrable domains in production (vercel.app / onrender.com) —
         every ordinary fetch() from the SPA to the API, including the /me
         check right after that redirect, is a cross-site request, and
         browsers never attach a Lax cookie to one. Without "None" there,
         the session was created correctly on the server and then
         invisible to the app that just created it.

         Local dev keeps "lax": frontend and API differ only by port there
         (localhost:5173 vs :5000), which the cookie spec treats as the
         same site, so fetch already carries the cookie — and "None"
         requires Secure, which a plain http://localhost origin can't set. */
      sameSite: config.isProduction ? "none" : "lax",
      secure: config.isProduction, // required by browsers whenever sameSite is "none"
      maxAge: SEVEN_DAYS_MS,
    },
  });
}
