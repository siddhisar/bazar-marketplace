/**
 * All server configuration — database URL, secrets, Google OAuth credentials,
 * feature toggles — is read from environment variables (`process.env`), not
 * hard-coded, and not committed to git. `dotenv/config` below loads a local
 * `backend/.env` file into `process.env` in development; in production
 * (Render) those same variable names are set directly in the hosting
 * platform's dashboard instead of a file. Either way, `config` below is the
 * only place `process.env` gets read — everything else in the backend
 * imports `config` instead, so there is one place to see everything the app
 * depends on being set, and no risk of a secret being logged by accident
 * from a stray `console.log(process.env)` elsewhere.
 */
import "dotenv/config";
import path from "node:path";

/**
 * Reads a required variable, throwing at import time when it is missing.
 * Used for settings that have no safe default — currently the database URL.
 *
 * @throws Error naming the variable, so the failure says what to set rather
 *         than surfacing later as an opaque connection error.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy backend/.env.example to backend/.env and fill it in.`
    );
  }
  return value;
}

/**
 * Reads the session-cookie signing secret. Falls back to an insecure,
 * published-in-this-file default in development — except in production,
 * where that fallback is exactly the kind of well-known string that lets
 * anyone forge a valid session cookie by signing one with it themselves. A
 * real value is required there, the same way `DATABASE_URL` always is.
 */
function readSessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not set. Set it in the hosting platform's environment " +
        "variables before deploying — the development fallback must never sign " +
        "session cookies in production."
    );
  }
  return "dev-only-insecure-session-secret";
}

/**
 * Origins allowed to call the API with credentials.
 *
 * A list rather than a single value because the frontend legitimately runs on
 * more than one local port — 5173 for `npm run dev`, 4173 for `vite preview` of
 * a production build — and allowing only one makes the other fail as an opaque
 * "Failed to fetch" in the browser, with nothing logged server-side to explain
 * it.
 *
 * Set CLIENT_URL to a comma-separated list to override. In production that is
 * normally one real origin. A wildcard is not an option: browsers refuse to send
 * cookies to one, and the session depends on them.
 */
const LOCAL_ORIGINS = [
  // `npm run dev`, then `vite preview` of a production build. Both hostnames are
  // listed for each: to a browser `localhost` and `127.0.0.1` are different
  // origins, so a page opened on one while only the other is allowed has every
  // request refused — and a CORS refusal is indistinguishable in the browser from
  // the server being down.
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
].join(",");

const clientUrls = (process.env.CLIENT_URL ?? LOCAL_ORIGINS)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Centralised, typed access to environment configuration.
 * Reads once at startup so the rest of the app never touches process.env directly.
 */
export const config = {
  port: Number(process.env.PORT ?? 5000),
  /**
   * Required. There is deliberately no fallback: the database now lives in
   * Supabase, and a default pointing at localhost would let a misconfigured
   * deployment start up and quietly read an empty local database instead of
   * failing where the mistake is visible.
   */
  databaseUrl: requireEnv("DATABASE_URL"),
  /** Every origin CORS will accept. See the note above. */
  clientUrls,
  /**
   * Where to send someone after the Google round trip. The first configured
   * origin, since a redirect has to name exactly one.
   */
  clientUrl: clientUrls[0],
  /**
   * Signs the session cookie. The development fallback exists so the app runs
   * out of the box; production refuses to boot without a real value set —
   * see `readSessionSecret` above.
   */
  sessionSecret: readSessionSecret(),
  isProduction: process.env.NODE_ENV === "production",
  /** Google OAuth. Empty means the Google routes report themselves unavailable. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleCallbackUrl:
    process.env.GOOGLE_CALLBACK_URL ??
    "http://localhost:5000/api/auth/google/callback",
  /** Folder on disk where listing/category/hero images live and are served from. */
  imagesDir: path.resolve(process.cwd(), "uploads", "images"),
  /** Public URL path the images are exposed under (stored paths begin with this). */
  imagesRoute: "/images",

  /* ---- Image storage -------------------------------------------------- */
  /**
   * Where the image bytes actually live.
   *
   * `listing_photos.path` stays in its `/images/...` form either way — it is a
   * logical path, not a filesystem one. That keeps the stored rows portable and
   * means the React app needs no knowledge of where files are hosted. Only this
   * setting decides whether `/images/*` is read off local disk or redirected to
   * the Supabase Storage bucket.
   *
   * Defaults to `supabase` once SUPABASE_URL is configured, because a deployed
   * backend has no `uploads/` folder and serving from disk there yields 404s.
   */
  imageStorage: (process.env.IMAGE_STORAGE ??
    (process.env.SUPABASE_URL ? "supabase" : "local")) as "local" | "supabase",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  /** Public (unauthenticated) base for the bucket holding listing photos. */
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "listing-photos",
  /**
   * Writes to Storage. Bypasses row-level security, so it must never reach the
   * client — it is read here and used only by server-side upload code.
   */
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};
