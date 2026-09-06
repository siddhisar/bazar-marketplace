/**
 * This file is the one place the backend actually connects to PostgreSQL
 * (hosted by Supabase). Every other file that needs to run a query imports
 * the `query()` function at the bottom of this file rather than connecting
 * to the database itself.
 *
 * A "connection pool" (the `Pool` from the `pg` library below) is a small
 * group of already-open connections to the database, reused across requests
 * instead of opening a brand new connection every time. Opening a connection
 * to a database that lives on another server takes real time (a network
 * round trip plus a security handshake); reusing one that's already open is
 * effectively free by comparison. With many users hitting the API at once,
 * a pool also means requests share a small, controlled number of
 * connections instead of each opening (and the database allowing) an
 * unlimited number.
 */
import { Pool, type QueryResultRow } from "pg";

let pool: Pool | undefined;

/**
 * How many connections to open before serving traffic.
 *
 * Warmed at all because opening one costs a TLS handshake to a hosted database —
 * measured near three seconds — and the search endpoint fans out to three
 * parallel queries, so a cold pool put that handshake on the first request.
 *
 * Kept to three, not more, because Supabase's session pooler allows 15 client
 * connections in total. `tsx watch` restarts overlap the old process with the
 * new one, so the real budget per process is half of that; warming six meant a
 * reload hit `EMAXCONNSESSION` and the server refused to boot at all.
 */
const WARM_CONNECTIONS = 3;

/**
 * Ceiling on the pool.
 *
 * Same 15-connection budget as above, halved for the restart overlap and left
 * with room for the pooler's own bookkeeping. Requests beyond this queue for a
 * live connection, which is cheaper than opening a new one anyway.
 */
const MAX_CONNECTIONS = 6;

/** Opens the shared connection pool. Call once on startup. */
export async function connectDatabase(connectionString: string): Promise<void> {
  pool = new Pool({
    connectionString,
    // Opening a connection to a hosted database costs a TLS handshake, which is
    // far more than any query on it. Holding connections open and reusing them
    // is what keeps that cost off the request path.
    keepAlive: true,
    // Long enough that a browsing visitor reuses a warm connection between
    // pages rather than reconnecting on each one.
    idleTimeoutMillis: 60_000,
    // Headroom above WARM_CONNECTIONS so a burst is queued against live
    // connections rather than triggering handshakes on the request path.
    max: MAX_CONNECTIONS,
  });

  // The migration also sets this on the database, but that only reaches sessions
  // opened afterwards. Setting it as each pooled connection is created means the
  // fuzzy search behaves the same however long the pool has been alive.
  pool.on("connect", (client) => {
    void client.query("SET pg_trgm.word_similarity_threshold = 0.2");
    // The facet-count query materialises a CTE over every active listing —
    // tens of thousands of rows, six columns each — and scans it once per
    // facet group. Past ~100k listings that no longer fits Postgres's 4MB
    // default work_mem, so it was spilling to on-disk temp files (visible as
    // "temp read/written" in EXPLAIN) instead of staying in memory, which
    // measured as most of the query's cost. 64MB is comfortably above what
    // the current data volume needs; revisit if the dataset grows much further.
    void client.query("SET work_mem = '64MB'");
  });
  /* One query first, on its own, to prove the database is actually reachable.
     This is the only part allowed to fail the boot. */
  const { rows } = await pool.query<{ current_database: string }>(
    "select current_database()"
  );
  console.log(`[db] connected to ${rows[0].current_database}`);

  /* Then open the rest of the warm set. Run in parallel deliberately: each query
     has to be in flight at the same time for the pool to create a separate
     connection for it, which is the whole point — sequential queries would be
     served by one connection reused three times and warm nothing.

     Failures here are logged and swallowed. Warming is an optimisation, and the
     way it fails is by hitting the pooler's client limit — exactly what happens
     when a `tsx watch` restart briefly overlaps the previous process. Treating
     that as fatal took the whole API down for the sake of a head start on the
     first request, which is a bad trade. A cold pool is slower, not broken. */
  try {
    await Promise.all(
      Array.from({ length: WARM_CONNECTIONS - 1 }, () =>
        pool!.query("select 1")
      )
    );
    console.log(`[db] ${WARM_CONNECTIONS} connections warmed`);
  } catch (err) {
    console.warn(
      `[db] could not pre-warm connections (${
        err instanceof Error ? err.message : String(err)
      }) — continuing; the pool will fill on demand`
    );
  }
}

/**
 * The live pool, for the one caller that needs the object itself rather than a
 * query: the session store, which manages its own connections otherwise.
 *
 * @throws Error if called before connectDatabase, which would otherwise hand out
 *         undefined and fail later at a confusing place.
 */
export function getPool(): Pool {
  if (!pool) throw new Error("Database pool not initialised — call connectDatabase first");
  return pool;
}

/** Closes the pool (used by the seed/migrate scripts and on shutdown). */
export async function disconnectDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Runs a parameterised query against the shared pool. */
export function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[] }> {
  if (!pool) throw new Error("Database pool not initialised — call connectDatabase first");
  return pool.query<T>(text, params);
}
