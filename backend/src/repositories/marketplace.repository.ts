/**
 * Data access for marketplace listings (the 100k-row searchable table).
 *
 * Kept separate from listing.repository.ts, which serves the fixed storefront
 * catalogue — different table, different lifecycle.
 *
 * This is a "repository" file: the only place allowed to write raw SQL for
 * listings. Controllers and services call the functions below instead of
 * writing their own queries, which keeps every query in one place to review
 * and keeps SQL out of the rest of the codebase.
 *
 * Every value that comes from outside the code (an id, a search term, a
 * limit) is passed as `$1`, `$2`, ... rather than glued into the SQL string
 * with template literals. Postgres receives the query text and the values
 * separately and never treats a value as more SQL to run — so even a value
 * like `'; DROP TABLE users; --` is just compared as a harmless piece of
 * text. Building the string by hand (e.g. `WHERE id = ${id}`) is what SQL
 * injection attacks exploit, so this codebase never does that.
 */
import { query } from "../config/database";

export type ListingRow = {
  id: string;
  title: string;
  category_slug: string;
  category_label: string;
  audience: "Men" | "Women" | "Unisex";
  brand: string | null;
  size: string | null;
  colour: string | null;
  condition: string;
  price: string;
  city: string;
  location: string | null;
  posted_at: Date;
  image: string | null;
};

export type ListingDetailRow = ListingRow & {
  description: string;
  images: string[];
  seller_id: number;
  seller_name: string;
  seller_created_at: Date;
  seller_phone: string | null;
  seller_contact_email: string | null;
  view_count: number;
  status: string;
  /** How many units remain — see the column's comment in marketplace.sql. */
  quantity: number;
};

export type FindListingsOptions = {
  categorySlug?: string;
  audience?: string;
  limit: number;
  offset: number;
};

/**
 * Columns shared by the list and detail queries. The primary photo comes from a
 * LATERAL subquery rather than a second round trip per row, so rendering a page
 * of results costs one query regardless of how many rows it holds.
 *
 * `LEFT JOIN LATERAL (...) ON true` below means: for each listing row, run
 * this small subquery (find its primary photo) as if it were a mini function
 * call, and attach the result as extra columns. "LATERAL" is what lets the
 * subquery refer to `l.id` from the outer row; without it, a subquery in a
 * JOIN cannot see the row it's being joined against. "LEFT" means a listing
 * with no photos yet still comes back, just with a null image instead of
 * being dropped entirely.
 */
const LIST_SELECT = `
  SELECT
    l.id::text,
    l.title,
    l.category_slug,
    c.label AS category_label,
    l.audience,
    l.brand,
    l.size,
    l.colour,
    l.condition::text,
    l.price,
    l.city,
    l.location,
    l.posted_at,
    -- A card renders the thumbnail generated at upload time; falls back to
    -- the full-size photo for every row seeded before thumbnails existed
    -- (thumb_path is NULL for all of those, by design — see upload.middleware.ts).
    COALESCE(photo.thumb_path, photo.path) AS image
  FROM listings l
  JOIN listing_categories c ON c.slug = l.category_slug
  LEFT JOIN LATERAL (
    SELECT path, thumb_path
    FROM listing_photos
    WHERE listing_id = l.id
    ORDER BY is_primary DESC, position ASC
    LIMIT 1
  ) AS photo ON true
`;

/**
 * Active listings, newest first, optionally narrowed by category and audience.
 * Both filters are pushed into SQL — nothing is filtered in Node.
 *
 * Returns at most `limit` rows starting at `offset`. Offset paging is fine for
 * browsing the first few pages of a category; deep pagination needs the cursor
 * approach and is handled separately.
 */
export async function findListings(
  options: FindListingsOptions,
): Promise<ListingRow[]> {
  const { rows } = await query<ListingRow>(
    `${LIST_SELECT}
     WHERE l.status = 'active'
       AND ($1::text IS NULL OR l.category_slug = $1)
       AND ($2::listing_audience IS NULL OR l.audience = $2)
     ORDER BY l.posted_at DESC, l.id DESC
     LIMIT $3 OFFSET $4`,
    [
      options.categorySlug ?? null,
      options.audience ?? null,
      options.limit,
      options.offset,
    ],
  );
  return rows;
}

/** Total active listings matching the same filters, for "N results" and paging. */
export async function countListings(options: {
  categorySlug?: string;
  audience?: string;
}): Promise<number> {
  const { rows } = await query<{ total: string }>(
    `SELECT count(*)::text AS total
     FROM listings l
     WHERE l.status = 'active'
       AND ($1::text IS NULL OR l.category_slug = $1)
       AND ($2::listing_audience IS NULL OR l.audience = $2)`,
    [options.categorySlug ?? null, options.audience ?? null],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Every listing ever created, regardless of status — active, sold, or
 * expired. Deliberately separate from `countListings` above: that one
 * answers "how many can I browse right now" and must stay status-filtered
 * for every existing caller (search, category pages, pagination). This one
 * answers "how big is the marketplace", for the homepage stat, and would be
 * the wrong number to hand to anything that filters or paginates.
 */
export async function countAllListings(): Promise<number> {
  const { rows } = await query<{ total: string }>(
    `SELECT count(*)::text AS total FROM listings`,
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * One listing with every photo and its seller's name. Returns null when the id
 * does not exist; sold and expired listings are still reachable by direct link,
 * which is why status is not filtered here.
 */
export async function findListingById(
  id: string,
): Promise<ListingDetailRow | null> {
  const { rows } = await query<ListingDetailRow>(
    `SELECT
       l.id::text,
       l.title,
       l.description,
       l.category_slug,
       c.label AS category_label,
       l.audience,
       l.brand,
       l.size,
       l.colour,
       l.condition::text,
       l.price,
       l.city,
       l.location,
       l.posted_at,
       l.view_count,
       l.status::text,
       l.quantity,
       l.seller_id,
       u.display_name AS seller_name,
       u.created_at AS seller_created_at,
       l.contact_phone AS seller_phone,
       u.contact_email AS seller_contact_email,
       COALESCE(
         (
           SELECT array_agg(path ORDER BY is_primary DESC, position ASC)
           FROM listing_photos
           WHERE listing_id = l.id
         ),
         '{}'
       ) AS images,
       (
         SELECT path
         FROM listing_photos
         WHERE listing_id = l.id
         ORDER BY is_primary DESC, position ASC
         LIMIT 1
       ) AS image
     FROM listings l
     JOIN listing_categories c ON c.slug = l.category_slug
     JOIN users u ON u.id = l.seller_id
     WHERE l.id = $1::bigint`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Records one open of a listing's detail page.
 *
 * A single UPDATE by primary key — O(1) regardless of how many listings
 * exist, so this is safe to run on every detail-page view even with 100k+
 * rows in the table; it never scans anything.
 *
 * Called only from the public GET /api/listings/:id path (see
 * `getListingById` in marketplace.controller.ts), never from the shared
 * `getListing()` used after a seller's own create/edit/sold/renew action —
 * routing it through there too would count a seller opening their own
 * listing to edit it as a "view".
 */
export async function incrementListingViewCount(id: string): Promise<void> {
  await query(
    `UPDATE listings SET view_count = view_count + 1 WHERE id = $1::bigint`,
    [id],
  );
}

/**
 * Who owns a listing, or null when there is no such listing.
 *
 * Deliberately returns only the id: an ownership check has no business loading
 * the row it is guarding, and keeping it to one column means the guard cannot
 * accidentally become a source of listing data.
 */
export async function findListingOwnerId(id: string): Promise<number | null> {
  const { rows } = await query<{ seller_id: number }>(
    `SELECT seller_id FROM listings WHERE id = $1::bigint`,
    [id],
  );
  return rows[0]?.seller_id ?? null;
}

/**
 * Attaches uploaded photos to a listing.
 *
 * The first path becomes the primary, which is what the grid shows; a unique
 * partial index enforces there being at most one, so callers must not pass a
 * set that overlaps photos the listing already has.
 */
export async function insertListingPhotos(
  listingId: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;

  await query(
    `INSERT INTO listing_photos (listing_id, path, is_primary, position)
     SELECT $1::bigint, path, ordinality = 1, ordinality - 1
       FROM unnest($2::text[]) WITH ORDINALITY AS t(path, ordinality)`,
    [listingId, paths],
  );
}

/** Categories with how many active listings each currently holds. */
export async function findCategoriesWithCounts(audience?: string): Promise<
  { slug: string; label: string; audience: string; total: number; image: string | null }[]
> {
  const { rows } = await query<{
    slug: string;
    label: string;
    audience: string;
    total: string;
    image: string | null;
  }>(
    `SELECT
       c.slug,
       c.label,
       c.audience::text,
       count(l.id)::text AS total,
       (
         SELECT p.path
         FROM listings l2
         JOIN listing_photos p ON p.listing_id = l2.id AND p.is_primary
         WHERE l2.category_slug = c.slug AND l2.status = 'active'
         LIMIT 1
       ) AS image
     FROM listing_categories c
     LEFT JOIN listings l
       ON l.category_slug = c.slug AND l.status = 'active'
     -- Main categories only. Subcategories live in the same table, marked by a
     -- parent_slug, and are fetched per-category rather than mixed into the
     -- top-level list the tiles and the filter sidebar render.
     WHERE c.parent_slug IS NULL
       AND ($1::listing_audience IS NULL OR c.audience = $1)
     GROUP BY c.slug, c.label, c.audience, c."order"
     ORDER BY c."order" ASC`,
    [audience ?? null],
  );

  return rows.map((row) => ({
    slug: row.slug,
    label: row.label,
    audience: row.audience,
    total: Number(row.total),
    image: row.image,
  }));
}
