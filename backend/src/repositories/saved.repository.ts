/**
 * Data access for a user's saved listings and saved searches.
 *
 * Every function takes the authenticated `userId` and scopes every statement to
 * it. That is the whole security model: a user physically cannot read or delete
 * another user's rows, because the id in the WHERE clause comes from the session,
 * never from the request body or path. There is no separate ownership check to
 * forget — ownership is the query.
 *
 * Several inserts below end in `ON CONFLICT (...) DO NOTHING`. Without it, a
 * repeat request (a double-click on "Save", or the same request retried after
 * a dropped connection) would fail with a unique-constraint error instead of
 * quietly succeeding a second time. "Idempotent" is the word for that: calling
 * it once or five times in a row leaves the database in the same state.
 */
import { query } from "../config/database";

/* ---------------------------------------------------------- saved listings */

/** The listing ids a user has saved, newest first. Ids only — the listings are
 *  fetched fresh so a saved one always shows the seller's current price. */
export async function listSavedListingIds(userId: number): Promise<string[]> {
  const { rows } = await query<{ listing_id: string }>(
    `SELECT listing_id
       FROM saved_listings
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((row) => row.listing_id);
}

/**
 * Saves a listing for a user. Idempotent: saving one already saved does nothing
 * rather than erroring on the (user_id, listing_id) primary key.
 *
 * @returns false if the listing id does not exist (the FK insert is caught and
 *          reported as "not found" rather than a 500).
 */
export async function addSavedListing(
  userId: number,
  listingId: string,
): Promise<boolean> {
  try {
    await query(
      `INSERT INTO saved_listings (user_id, listing_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, listing_id) DO NOTHING`,
      [userId, listingId],
    );
    return true;
  } catch (err) {
    // 23503 = foreign_key_violation: the listing id is not a real listing.
    if ((err as { code?: string }).code === "23503") return false;
    throw err;
  }
}

/** Removes one saved listing. A no-op if it was not saved. */
export async function removeSavedListing(
  userId: number,
  listingId: string,
): Promise<void> {
  await query(
    `DELETE FROM saved_listings WHERE user_id = $1 AND listing_id = $2`,
    [userId, listingId],
  );
}

/* ---------------------------------------------------------- saved searches */

export type SavedSearchRow = {
  id: number;
  name: string;
  query: string;
  seen_count: number;
  last_viewed_at: Date;
  created_at: Date;
};

const SAVED_SEARCH_COLUMNS =
  "id, name, query, seen_count, last_viewed_at, created_at";

/** A user's saved searches, newest first. */
export async function listSavedSearches(
  userId: number,
): Promise<SavedSearchRow[]> {
  const { rows } = await query<SavedSearchRow>(
    `SELECT ${SAVED_SEARCH_COLUMNS}
       FROM saved_searches
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

/**
 * Creates a saved search.
 *
 * `seenCount` is the result total at save time, so the "new since" badge starts
 * at zero rather than counting every existing listing as new. The frontend
 * computes it (it already runs the search to show results) and passes it in.
 */
export async function createSavedSearch(input: {
  userId: number;
  name: string;
  query: string;
  seenCount: number;
}): Promise<SavedSearchRow> {
  const { rows } = await query<SavedSearchRow>(
    `INSERT INTO saved_searches (user_id, name, query, seen_count)
     VALUES ($1, $2, $3, $4)
     RETURNING ${SAVED_SEARCH_COLUMNS}`,
    [input.userId, input.name, input.query, input.seenCount],
  );
  return rows[0];
}

/**
 * Deletes a saved search the user owns.
 *
 * @returns true if a row was deleted; false if none matched — which for a
 *          user-scoped delete means either it never existed or it belongs to
 *          someone else. Both are a 404 to the caller, so a probe cannot tell
 *          "not yours" from "not there".
 */
export async function deleteSavedSearch(
  userId: number,
  id: number,
): Promise<boolean> {
  const { rows } = await query<{ id: number }>(
    `DELETE FROM saved_searches WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

/**
 * Marks a saved search as just viewed: stamps the time and rebaselines the count
 * to `seenCount`, so its badge resets to zero. Scoped to the owner.
 *
 * @returns true if a row was updated, false otherwise (not found / not theirs).
 */
export async function markSavedSearchViewed(
  userId: number,
  id: number,
  seenCount: number,
): Promise<boolean> {
  const { rows } = await query<{ id: number }>(
    `UPDATE saved_searches
        SET last_viewed_at = now(), seen_count = $3
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [id, userId, seenCount],
  );
  return rows.length > 0;
}
