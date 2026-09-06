/**
 * This is the file that actually starts the backend server.
 *
 * Running `npm run dev` or `npm start` executes this file. It does three
 * things, in order: connect to the database, start listening for HTTP
 * requests (using the Express app built in `app.ts`), and start a background
 * timer that expires old listings. If any of this fails — most commonly the
 * database connection — the process exits instead of running half-broken.
 */
import { createApp } from "./app";
import { config } from "./config/env";
import { connectDatabase } from "./config/database";
import { sweepExpiredListings } from "./repositories/listingWrite.repository";
import { hasOnlyExpressionInitializer } from "typescript";

/**
 * How often to flip active-but-past-`expires_at` listings to `expired`.
 *
 * There is no job queue in this stack, so a plain timer on the one running
 * process is the whole mechanism — the sweep itself is a single idempotent
 * `UPDATE`, so a slightly-late run costs nothing beyond one listing staying
 * technically visible a few minutes past its expiry, never incorrectness.
 */
const EXPIRY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Starts a repeating background job that marks expired listings as expired.
 *
 * `setInterval` is a built-in JavaScript function: give it a function and a
 * number of milliseconds, and it calls that function again and again, forever,
 * on that schedule. `run()` is called once immediately (so listings don't wait
 * up to 5 minutes after a fresh server start) and then every 5 minutes after.
 *
 * `sweepExpiredListings()` returns a Promise (because it talks to the
 * database, which takes time). `.then(...)` runs once that Promise succeeds;
 * `.catch(...)` runs if it fails instead. This is an older style than
 * `async`/`await` (used everywhere else in this project) but does the same
 * job: "do this, and when it's done, do that."
 */
function scheduleExpirySweep(): void {
  const run = () => {
    sweepExpiredListings()
      .then((count) => {
        if (count > 0) console.log(`[expiry] ${count} listing(s) expired`);
      })
      .catch((err) => console.error("[expiry] sweep failed:", err));
  };

  run();
  setInterval(run, EXPIRY_SWEEP_INTERVAL_MS);
}

/**
 * Boots the whole backend, in the order things actually depend on each other:
 * 1. Connect to Postgres first — the API cannot answer a single request
 *    without a database, so `await` here means "wait until this finishes
 *    before doing anything else."
 * 2. Build the Express app (`createApp()`, defined in `app.ts` — that file
 *    has all the routes and middleware) and start listening for requests.
 * 3. Start the background job that expires old listings.
 */
async function start(): Promise<void> {
  await connectDatabase(config.databaseUrl);

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[server] API listening on http://localhost:${config.port}`);
    console.log(`[server] images served from ${config.imagesRoute}`);
  });

  scheduleExpirySweep();
}

// Run the startup function above. `async` functions always return a Promise,
// so `.catch(...)` here catches any error from anywhere inside `start()` —
// for example, the database being unreachable — and exits the process with a
// non-zero code so a deploy platform like Render knows the start-up failed.
start().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});

