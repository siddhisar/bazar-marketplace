/**
 * Per-viewer tracking for a seller's "who viewed my listing" list.
 *
 * Separate from `incrementListingViewCount` (marketplace.repository.ts),
 * which stays an unconditional raw counter — this table only ever gets a row
 * for a signed-in visitor who is not the listing's own seller, deduplicated
 * per (listing, viewer) so a repeat visit updates a timestamp instead of
 * growing an unbounded log.
 */
import { query } from "../config/database";

/**
 * Records one signed-in visit to a listing, or refreshes it if this viewer
 * has been here before.
 *
 * Callers are responsible for not calling this for the listing's own seller
 * or for an anonymous visitor (see getListingById in marketplace.controller.ts)
 * — this function itself has no way to tell "the owner looked at their own
 * listing" from "a genuine viewer", so that exclusion has to happen before
 * the call, not inside this query.
 */
export async function recordListingView(
  listingId: string,
  viewerId: number,
): Promise<void> {
  await query(
    `INSERT INTO listing_views (listing_id, viewer_id)
     VALUES ($1::bigint, $2)
     ON CONFLICT (listing_id, viewer_id)
     DO UPDATE SET last_viewed_at = now()`,
    [listingId, viewerId],
  );
}

export type ListingViewerRow = {
  viewer_id: number;
  display_name: string;
  first_viewed_at: Date;
  last_viewed_at: Date;
};

/** Every distinct signed-in viewer of one listing, most recently viewed first. */
export async function findListingViewers(
  listingId: string,
): Promise<ListingViewerRow[]> {
  const { rows } = await query<ListingViewerRow>(
    `SELECT u.id AS viewer_id, u.display_name,
            v.first_viewed_at, v.last_viewed_at
       FROM listing_views v
       JOIN users u ON u.id = v.viewer_id
      WHERE v.listing_id = $1::bigint
      ORDER BY v.last_viewed_at DESC`,
    [listingId],
  );
  return rows;
}
