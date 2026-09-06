/**
 * This file builds the Express application itself: every request that
 * reaches the backend passes through the pieces set up here, in the order
 * they're added, before it ever reaches a route handler.
 *
 * Express calls each of these pieces "middleware" — a function that runs on
 * every request (or every request to a matching path) and then either
 * finishes the response itself or calls `next()` to let the next piece run.
 * `app.use(...)` is how a piece of middleware gets added to that pipeline.
 * The order below matters: CORS has to run before anything else can respond,
 * sessions have to be set up before a route can check who's logged in, and
 * the error handler has to be added last so it can catch problems from
 * everything above it.
 *
 * This is also where the two route "sub-apps" get attached — one for
 * authentication (`/api/auth/...`) and one for everything else
 * (`/api/...`, defined in `routes/index.ts`).
 */
import express from "express";
import cors from "cors";
import { config } from "./config/env";
import apiRouter from "./routes/index";
import authRouter from "./routes/auth.routes";
import { buildSessionMiddleware } from "./middleware/session.middleware";
import { errorHandler, notFound } from "./middleware/error.middleware";
import { query } from "./config/database";

/** Loopback and RFC1918 ranges — a machine on the developer's own network. */
const LOCAL_HOSTNAME =
  /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

/**
 * Whether a browser origin may call this API with credentials.
 *
 * Production is strict: only what CLIENT_URL names.
 *
 * Development also accepts any loopback or private-network origin on any port.
 * The dev frontend legitimately appears on several — 5173, 4173, `localhost` vs
 * `127.0.0.1`, and the LAN address Vite prints for testing on a phone — and each
 * is a distinct origin to a browser. Enumerating them was a losing game: the
 * failure is a refused request, which the browser reports identically to the
 * server being down, so a missing entry costs far more time to diagnose than the
 * permissiveness is worth on a local machine.
 *
 * Not a wildcard even so. `credentials: true` with `*` is rejected by browsers,
 * and the session depends on the cookie, so the origin has to be reflected back.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  // No Origin header: same-origin navigations, curl, server-to-server.
  if (!origin) return true;
  if (config.clientUrls.includes(origin)) return true;
  if (config.isProduction) return false;

  try {
    return LOCAL_HOSTNAME.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Builds the Express app (no listening / no DB — kept pure for testing). */
export function createApp() {
  const app = express();

  // Stamped before anything else runs, so a handler can report how much of
  // its own total time was spent before it started (CORS, session, JSON
  // parsing) versus its own work — see `Server-Timing` on
  // GET /api/search/listings. Does not capture time spent before Node even
  // accepted the connection (OS-level accept-queue delay under a starved
  // event loop), which is what makes it possible to tell the two apart: any
  // gap between this and a client's own measured time-to-first-byte is time
  // this process was not yet free to run at all.
  app.use((_req, res, next) => {
    res.locals.startAt = process.hrtime.bigint();
    next();
  });

  // CORS (Cross-Origin Resource Sharing) is a browser security rule: a web
  // page loaded from one address (the React app on Vercel) is normally
  // blocked from calling an API on a different address (this backend on
  // Render), unless the API explicitly says "this origin is allowed." That's
  // what this middleware does — `isAllowedOrigin` above decides yes or no
  // for each incoming request's origin.
  //
  // `credentials` and an explicit (reflected) origin are both required for the
  // session cookie to survive a cross-origin request: browsers refuse to send
  // cookies to a wildcard origin.
  //
  // `maxAge` matters specifically on a slow backend: every state-changing
  // request (and some GETs, depending on headers) is "not simple" to a
  // browser and pays a full OPTIONS preflight round trip before the real one
  // — a second hit of whatever this instance's latency is, on top of the
  // first. With no `maxAge` set, that preflight is cached for a few seconds
  // at most (browsers differ; some cache nothing at all without this header
  // present), so a person clicking around the site pays it repeatedly.
  // 24 hours is the maximum Chromium honours; the response fields it caches
  // are static (the same origin is allowed or not, regardless of path), so
  // there's nothing here that stale-caching could get wrong.
  app.use(
    cors({
      origin: (origin, done) => done(null, isAllowedOrigin(origin)),
      credentials: true,
      maxAge: 86400,
    })
  );
  app.use(express.json());

  // Session cookie is signed, so the app has to know it is behind a proxy in
  // production or `secure: true` cookies are dropped.
  if (config.isProduction) app.set("trust proxy", 1);
  app.use(buildSessionMiddleware());

  // Serve listing/category/hero images. A row stored as "/images/foo.jpg"
  // resolves to <imagesDir>/foo.jpg locally, or to the same key inside the
  // Supabase Storage bucket once the app is deployed.
  //
  // The Supabase branch answers 302 rather than streaming the bytes back: the
  // browser then pulls the file straight from Supabase's CDN, so image traffic
  // never occupies an API process. Redirecting (instead of rewriting the stored
  // paths) also keeps `listing_photos.path` provider-agnostic — moving hosts
  // again is a config change, not a data migration.
  if (config.imageStorage === "supabase") {
    const bucketBase = `${config.supabaseUrl}/storage/v1/object/public/${config.storageBucket}`;
    app.use(config.imagesRoute, (req, res) => {
      // Mounted at /images, so req.path is the remainder, e.g. "/api/foo.webp".
      res.redirect(302, `${bucketBase}${req.path}`);
    });
  } else {
    app.use(config.imagesRoute, express.static(config.imagesDir));
  }

  app.get("/health", (_req, res) => {
    res.json({ success: true, status: "ok" });
  });

  /**
   * Diagnostic only — not part of the API contract, temporary while chasing
   * down why the deployed API measures 500ms-2s per search despite every
   * query costing single-digit-to-tens-of-ms at the database (see README
   * "Known limitations"). `dbRoundTripMs` times a trivial `SELECT 1` from
   * inside this process, so it isolates the Render<->Supabase network hop
   * from everything else (query cost, client<->Render latency, cold starts).
   * `region` is Render's own env var, for comparing against Supabase's
   * project region directly instead of guessing from symptoms.
   */
  app.get("/health/latency", (_req, res) => {
    const startedAt = Date.now();
    query("SELECT 1")
      .then(() => {
        res.json({
          success: true,
          data: {
            region: process.env.RENDER_REGION ?? null,
            dbRoundTripMs: Date.now() - startedAt,
          },
        });
      })
      .catch((err) => {
        res.status(500).json({
          success: false,
          error: err instanceof Error ? err.message : "unknown",
        });
      });
  });

  // Attach the two route files. Everything inside authRouter answers at
  // "/api/auth/..." (login, register, Google sign-in); everything inside
  // apiRouter (routes/index.ts) answers at "/api/..." (listings, search,
  // saved items). If a request doesn't match any route in either file...
  app.use("/api/auth", authRouter);
  app.use("/api", apiRouter);

  // ...it falls through to here: `notFound` sends a clean 404 instead of
  // Express's default HTML error page. `errorHandler` is different — it only
  // runs when a route handler throws or calls `next(err)`, and it must be
  // registered last, because Express recognises "this middleware handles
  // errors" by it taking four arguments instead of the usual three.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
