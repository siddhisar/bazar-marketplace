/**
 * Writes against `listings` — create, edit, delete, mark sold, renew — plus the
 * seller's own listing feed.
 *
 * Ownership is not checked here. Every one of these is reached through
 * `requireListingOwner`, which resolves `listings.seller_id` and refuses before
 * the handler runs. Keeping the check in one middleware rather than repeating
 * it in each query means a new endpoint cannot forget it by omission — it has
 * to be left off the route deliberately.
 *
 * A recurring pattern below is `UPDATE ... RETURNING id`: instead of updating
 * and then running a separate SELECT to check whether anything changed, the
 * single UPDATE hands back the id of whatever row it touched. No rows back
 * means the WHERE clause matched nothing (wrong id, or someone else's row),
 * which the caller reports as "not found" — one query instead of two.
 */
import { query } from "../config/database";
import { thumbPathFor } from "../middleware/upload.middleware";
import type { ListingRow } from "./marketplace.repository";

/** How long a listing stays live, and what renewing extends it by. */
export const LISTING_LIFETIME_DAYS = 45;

export type SellerListingRow = ListingRow & {
  description: string;
  status: string;
  view_count: number;
  /** How many units remain — see the column's comment in marketplace.sql. */
  quantity: number;
  /**
   * Distinct signed-in, non-owner viewers — what "who viewed this listing"
   * (listingViews.repository.ts) can actually list by name. Deliberately not
   * `view_count`: that raw counter also includes the seller's own visits and
   * anonymous ones, neither of which the viewer-history modal shows, so
   * displaying `view_count` as "N views" while the modal opened by clicking
   * it can only ever list a subset of N read as a bug (confirmed live — 5
   * raw views on a listing whose seller had opened it themselves several
   * times, one genuine outside viewer, and the modal correctly showing only
   * that one). This is the number the modal can actually back up.
   */
  viewer_count: number;
  expires_at: Date;
  subcategory_slug: string | null;
};

/**
 * Every listing owned by one user, newest first.
 *
 * Unlike the public feed this returns sold and expired rows too — the whole
 * point of the dashboard is managing them, and the status tabs need something
 * to count.
 */
export async function findListingsBySeller(
  sellerId: number,
): Promise<SellerListingRow[]> {
  const { rows } = await query<SellerListingRow>(
    `SELECT
       l.id::text, l.title, l.description, l.category_slug, l.subcategory_slug,
       c.label AS category_label, l.audience, l.brand, l.size, l.colour,
       l.condition::text, l.price, l.city, l.location, l.posted_at,
       l.status::text, l.view_count, l.quantity, l.expires_at,
       COALESCE(photo.thumb_path, photo.path) AS image,
       COALESCE(viewers.count, 0) AS viewer_count
     FROM listings l
     JOIN listing_categories c ON c.slug = l.category_slug
     LEFT JOIN LATERAL (
       SELECT path, thumb_path FROM listing_photos
       WHERE listing_id = l.id
       ORDER BY is_primary DESC, position ASC
       LIMIT 1
     ) AS photo ON true
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS count FROM listing_views WHERE listing_id = l.id
     ) AS viewers ON true
     WHERE l.seller_id = $1
     ORDER BY l.posted_at DESC, l.id DESC`,
    [sellerId],
  );
  return rows;
}

export type NewListing = {
  sellerId: number;
  title: string;
  description: string;
  categorySlug: string;
  subcategorySlug: string | null;
  condition: string;
  price: number;
  /** How many units this listing represents — see the column's comment in marketplace.sql. */
  quantity: number;
  city: string;
  location: string | null;
  images: string[];
  /** This listing's own contact number — see the column's comment in marketplace.sql. */
  phone: string;
};

/**
 * Inserts a listing and attaches its photos in one transaction.
 *
 * `sellerId` comes from the session, never from the request body — a caller
 * must not be able to post an advert in someone else's name.
 */
export async function createListing(input: NewListing): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO listings
       (seller_id, title, description, category_slug, subcategory_slug,
        audience, condition, price, quantity, city, location, contact_phone,
        status, expires_at)
     VALUES ($1,$2,$3,$4,$5,'Unisex',$6::listing_condition,$7,$8,$9,$10,$11,'active',
             now() + ($12 || ' days')::interval)
     RETURNING id::text`,
    [
      input.sellerId, input.title, input.description, input.categorySlug,
      input.subcategorySlug, input.condition, input.price, input.quantity,
      input.city, input.location, input.phone, LISTING_LIFETIME_DAYS,
    ],
  );

  const id = rows[0].id;

  if (input.images.length > 0) {
    // The thumbnail for each photo was already generated and stored at
    // upload time (`persistUploads`), at the deterministic path
    // `thumbPathFor` computes here — nothing to look up, just the same
    // string transform applied to what `postListingImages` already
    // returned.
    const thumbPaths = input.images.map(thumbPathFor);

    await query(
      `INSERT INTO listing_photos (listing_id, path, thumb_path, is_primary, position)
       SELECT $1::bigint, path, thumb_path, ordinality = 1, ordinality - 1
         FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS t(path, thumb_path, ordinality)`,
      [id, input.images, thumbPaths],
    );
  }

  return id;
}

export type ListingPatch = {
  title?: string;
  description?: string;
  categorySlug?: string;
  subcategorySlug?: string | null;
  condition?: string;
  price?: number;
  /** How many units this listing represents — see the column's comment in marketplace.sql. */
  quantity?: number;
  city?: string;
  location?: string | null;
  /** This listing's own contact number — see the column's comment in marketplace.sql. */
  phone?: string;
  /** Replaces every existing photo, in this order (first = cover) — see below. */
  images?: string[];
};

/**
 * Applies a partial update.
 *
 * Built from only the fields actually supplied, so omitting one leaves it
 * alone rather than nulling it. Returns false when the patch was empty.
 *
 * `images`, when present, replaces the whole set rather than patching
 * individual photos: the editor sends back the complete list it wants —
 * kept existing paths and newly-uploaded ones interleaved in display order —
 * so "replace everything" is the only version of "update the photos" that
 * needs expressing here, the same way `createListing` only ever inserts a
 * complete set once. Delete-then-reinsert inside one transaction-scoped
 * `query` pair rather than diffing old vs. new rows: with at most
 * `MAX_PHOTOS` (8) rows, there is nothing an ordinality-preserving diff would
 * save that is worth the extra logic.
 */
export async function updateListing(
  id: string,
  patch: ListingPatch,
): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  const columns: [keyof ListingPatch, string, string][] = [
    ["title", "title", ""],
    ["description", "description", ""],
    ["categorySlug", "category_slug", ""],
    ["subcategorySlug", "subcategory_slug", ""],
    ["condition", "condition", "::listing_condition"],
    ["price", "price", ""],
    ["quantity", "quantity", ""],
    ["city", "city", ""],
    ["location", "location", ""],
    ["phone", "contact_phone", ""],
  ];

  for (const [key, column, cast] of columns) {
    if (patch[key] !== undefined) sets.push(`${column} = ${bind(patch[key])}${cast}`);
  }

  if (sets.length === 0 && patch.images === undefined) return false;

  if (sets.length > 0) {
    sets.push("updated_at = now()");
    values.push(id);
    await query(
      `UPDATE listings SET ${sets.join(", ")} WHERE id = $${values.length}::bigint`,
      values,
    );
  }

  if (patch.images !== undefined) {
    await query(`DELETE FROM listing_photos WHERE listing_id = $1::bigint`, [id]);

    if (patch.images.length > 0) {
      // Same thumbnail-path derivation as createListing — see its comment.
      const thumbPaths = patch.images.map(thumbPathFor);
      await query(
        `INSERT INTO listing_photos (listing_id, path, thumb_path, is_primary, position)
         SELECT $1::bigint, path, thumb_path, ordinality = 1, ordinality - 1
           FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS t(path, thumb_path, ordinality)`,
        [id, patch.images, thumbPaths],
      );
    }
  }

  return true;
}

/** Photos cascade via the foreign key, so one statement is enough. */
export async function deleteListing(id: string): Promise<void> {
  await query(`DELETE FROM listings WHERE id = $1::bigint`, [id]);
}

/**
 * Sells one unit: decrements `quantity` by one, and only flips `status` to
 * 'sold' once none remain — a listing with several identical units stays
 * `active` (with a lower `quantity`) after one sells, exactly the seller
 * dashboard's own "Mark as sold" button either way.
 *
 * `WHERE status = 'active' AND quantity > 0` is what makes this safe against
 * a double click or two overlapping requests: Postgres locks the row for the
 * whole UPDATE, so two concurrent calls serialise rather than race, and the
 * second one's WHERE clause re-evaluates against whatever the first left
 * behind — once quantity reaches 0 and status flips to 'sold', every further
 * call matches zero rows and is a no-op, never a negative quantity or a
 * second decrement. Returns null for that no-op case; the caller (see
 * postListingSold) treats it the same as a successful sell and just
 * re-reads the listing's current state either way, which is what keeps
 * "selling twice" from being an error.
 */
export async function markListingSold(
  id: string,
): Promise<{ quantity: number; status: string } | null> {
  const { rows } = await query<{ quantity: number; status: string }>(
    `UPDATE listings
        SET quantity = quantity - 1,
            status = CASE WHEN quantity - 1 <= 0 THEN 'sold' ELSE status END,
            sold_at = CASE
                        WHEN quantity - 1 <= 0 THEN COALESCE(sold_at, now())
                        ELSE sold_at
                      END,
            updated_at = now()
      WHERE id = $1::bigint AND status = 'active' AND quantity > 0
      RETURNING quantity, status::text`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Puts an expired listing back on the market for another full term.
 *
 * Measured from now rather than from the old expiry, so renewing something that
 * lapsed months ago gives a full window rather than a date already in the past.
 * A sold listing is not renewed — that would quietly un-sell it.
 */
export async function renewListing(id: string): Promise<boolean> {
  // RETURNING rather than rowCount: the shared `query` helper exposes only
  // rows, so a returned id is how "did this match anything" is answered.
  const { rows } = await query<{ id: string }>(
    `UPDATE listings
        SET status = 'active',
            expires_at = now() + ($2 || ' days')::interval,
            updated_at = now()
      WHERE id = $1::bigint AND status <> 'sold'
      RETURNING id::text`,
    [id, LISTING_LIFETIME_DAYS],
  );
  return rows.length > 0;
}

/**
 * Flips every active listing whose `expires_at` has passed to `expired`.
 *
 * Search and browse only ever filter on `status = 'active'`, never on
 * `expires_at` directly, so this sweep is what actually makes "listings
 * expire and drop out of search" true rather than aspirational — without
 * it, an active row past its `expires_at` would keep appearing in every
 * result until someone renewed or deleted it. `listings_expires_at_idx`
 * (partial, `WHERE status = 'active'`) is what this scans.
 *
 * A plain `UPDATE ... WHERE`, not a `SELECT` first: idempotent and safe to
 * call from more than one process (or the same one twice in a row) without
 * coordination, which is what lets it run on a simple timer rather than
 * needing a job queue or a lock.
 */
export async function sweepExpiredListings(): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `UPDATE listings
        SET status = 'expired', updated_at = now()
      WHERE status = 'active' AND expires_at <= now()
      RETURNING id::text`,
  );
  return rows.length;
}
