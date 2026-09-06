/**
 * This file builds SQL query text as strings — but never by pasting user
 * input directly into that text. Every filter turns into a `$1`, `$2`, ...
 * placeholder, and the actual value travels alongside in a separate `values`
 * array; the database driver combines them safely later. This is what
 * "parameterized SQL" means in practice, and it's the reason this app is safe
 * from SQL injection even though the search box builds a query dynamically
 * from whatever filters are selected.
 *
 * This is also where "filtering" happens for the whole search feature:
 * `buildListingWhere` below turns the selected filters (category, price
 * range, condition, city, ...) into one SQL `WHERE` clause, all applied
 * together in the database — never by fetching everything and filtering it
 * in JavaScript afterwards, which would not scale to 100,000+ listings.
 *
 * SQL construction for listing search.
 *
 * Every filter value is passed as a bind parameter — nothing is interpolated
 * into the string. The search box is the most obvious injection vector in the
 * app and the brief says it will be tested as one, so the only thing this module
 * ever concatenates is fragments it authored itself.
 */

/** Sorts the API accepts. `relevance` is only meaningful with a query. */
export type SortKey = "relevance" | "newest" | "price_asc" | "price_desc";

/**
 * How close a fuzzy match must be to the *best* match found for the same
 * query to count as genuinely relevant, rather than being let through only
 * because it cleared the index's own loose prefilter.
 *
 * `word_similarity` scores the query against the closest-matching *window*
 * within a title, not the title as a whole. At this catalogue's scale
 * (100,000+ titles), a short, unremarkable word that happens to recur across
 * many unrelated titles (a condition phrase like "— Well Maintained" showing
 * up on furniture, electronics and vehicles alike) coincidentally scores at
 * or near the trigram index's own threshold against almost *any* query — high
 * enough to pass `<%`, indistinguishable by score from noise. A genuine typo
 * match ("dumbell" for "Dumbbell Set", 0.7) sits far above that noise floor
 * (0.25); this ratio keeps the gap between them from being a coincidence the
 * query has to get lucky on.
 *
 * Relative rather than a single fixed cutoff, because "how good the best
 * match is" varies enormously by query — a near-exact typo scores close to 1,
 * a longer or more garbled one much lower — and a fixed threshold tuned for
 * one would wrongly admit noise for the other, or wrongly exclude the best
 * match for the other.
 */
export const FUZZY_RELEVANCE_RATIO = 0.8;

/**
 * A floor under the ratio above, for the case where even the *best* fuzzy
 * match is itself only as good as the noise around it (no real match exists
 * for the query at all) — without this, a ratio applied to an already-low
 * best score would still admit everything tied with it.
 *
 * 0.35, not the rounder 0.3: measured directly against this dataset,
 * "clothing" (no listing title uses that word) scored its best fuzzy match
 * against "Front Load Washing Machine" at 0.333 — a coincidental shared
 * suffix ("-othing"/"-ashing"), not a typo correction — which the old 0.3
 * floor let through as if it were one. Every genuine typo correction
 * checked scored comfortably higher (worst: "labtop" -> "Laptop" at 0.4),
 * so 0.35 sits in the gap between the two without excluding any of them.
 */
export const FUZZY_RELEVANCE_FLOOR = 0.35;

/**
 * A fuzzy match only counts when it is reasonably close to the best match
 * found for this same query — not merely above the trigram index's own loose
 * prefilter (`<%`, a fixed database-wide threshold chosen to keep the index
 * useful, not to define "relevant"). See `FUZZY_RELEVANCE_RATIO` for why.
 *
 * Deliberately scoped to `status = 'active'` and the query alone, not to
 * whichever other filters (category, price, ...) happen to be selected: how
 * good a "genuine" match looks for a given search term is a property of the
 * term itself, not of an unrelated filter someone also has selected, and
 * scoping it globally is what keeps this clause identical everywhere it's
 * used — the rows query, the count query, and the facets query all compute
 * "relevant" the same way regardless of which of *their* other filters are
 * active, which is what keeps their results describing the same set.
 *
 * The subquery references only the bind parameter at `queryPlaceholder`, not
 * any column of the outer query — so Postgres evaluates it once per query
 * (an "InitPlan"), not once per candidate row, and it costs about the same as
 * the `<%` prefilter it reads from: both scan the same GIN-trigram-narrowed
 * candidate set, not the full table.
 *
 * Every query that filters, counts or facets a fuzzy search must use this
 * exact clause, or its results will describe a different set of rows than
 * the others do — see `searchListingsFuzzy`, `countSearchMatches`'s fuzzy
 * branch, and the facet query's fuzzy branch.
 */
export function fuzzyRelevanceClause(queryPlaceholder: string): string {
  return `word_similarity(${queryPlaceholder}, l.title) >= GREATEST(
    (SELECT MAX(word_similarity(${queryPlaceholder}, l2.title))
       FROM listings l2
      WHERE l2.status = 'active' AND ${queryPlaceholder} <% l2.title
    ) * ${FUZZY_RELEVANCE_RATIO},
    ${FUZZY_RELEVANCE_FLOOR}
  )`;
}

/**
 * The same "must be close to the best match, not merely above some fixed
 * bar" idea as `fuzzyRelevanceClause`, applied to the *exact* (tsquery) path.
 *
 * `search_vector` weights title 'A' (1.0) and description 'B' (0.4), so in
 * principle a title hit already outranks a description-only one. In practice
 * that gap was never enforced as a cutoff — every row `@@`-matching the
 * query was returned regardless of how it matched, and at 100,000+ rows an
 * ordinary word ("top", "well", "— Good Condition") recurs across enough
 * unrelated *descriptions* that they can outnumber the genuine title matches
 * many times over. Measured against this catalogue: searching "top" returns
 * 473 listings with "top" in the title and 1,869 that only mention it in the
 * description — undifferentiated by the plain `@@` check, and with `rank`
 * clustering into exactly two values (title hits ≈0.61-0.67, description-only
 * hits ≈0.24 — see the constants above's fuzzy analogue), so a ratio against
 * the best match for this query cleanly separates them the same way it does
 * for fuzzy, without needing a fixed cutoff tuned per query shape.
 *
 * Same scoping rule as the fuzzy clause: only `status = 'active'` and the
 * query itself, so the rows query, the count query and the facets query all
 * agree on what counts as relevant regardless of which other filters each of
 * them has active.
 */
export const EXACT_RELEVANCE_RATIO = 0.8;

/**
 * Floor under the ratio above, for a query with no title hits at all (every
 * match is description-only, all clustered at the same, lower rank) — without
 * it, the ratio would be computed against that lower ceiling and could still
 * exclude the very matches it's meant to admit as "the best available".
 */
export const EXACT_RELEVANCE_FLOOR = 0.05;

export function exactRelevanceClause(queryPlaceholder: string): string {
  return `ts_rank(l.search_vector, websearch_to_tsquery('english', ${queryPlaceholder})) >= GREATEST(
    (SELECT MAX(ts_rank(l2.search_vector, websearch_to_tsquery('english', ${queryPlaceholder})))
       FROM listings l2
      WHERE l2.status = 'active' AND l2.search_vector @@ websearch_to_tsquery('english', ${queryPlaceholder})
    ) * ${EXACT_RELEVANCE_RATIO},
    ${EXACT_RELEVANCE_FLOOR}
  )`;
}

export type ListingFilters = {
  q?: string;
  /** Empty means "any category". Narrowed with ANY(...), same as conditions. */
  categorySlugs?: string[];
  /** Narrows within categorySlugs — e.g. "mens-fashion--mens-shirts". Only meaningful alongside exactly one category. */
  subcategorySlug?: string;
  audience?: string;
  /** Empty means "any city". Narrowed with ANY(...), same as conditions. */
  cities?: string[];
  /** Empty means "any condition". */
  conditions?: string[];
  /** Empty means "any size". */
  sizes?: string[];
  /** Empty means "any colour". */
  colours?: string[];
  /**
   * Selected `PRICE_BANDS` ids (see PRICE_BAND_SQL) — an alternative to
   * minPrice/maxPrice, not a further narrowing of it: the UI clears one
   * whenever the other is set, since "under ₹5,000" and "above ₹20,000, under
   * ₹40,000" answer the same question two different ways. Both are still
   * applied here if a hand-built URL somehow carries both, same as any other
   * two filters — AND, not a special case.
   */
  priceBands?: string[];
  minPrice?: number;
  maxPrice?: number;
  /** "Posted within" in days. */
  postedWithinDays?: number;
};

/**
 * Buckets a price into one of `PRICE_BANDS`' (see lib/search.ts on the
 * frontend) ids — `'0-5000'`, `'5000-20000'`, `'20000-50000'`, `'50000-'`.
 * Shared between the price facet (which needs to *count* listings per band)
 * and multi-select band filtering (which needs to *match* listings against
 * one or more selected bands) — both are "which band is this row in?",
 * answered the same way so the two can never disagree.
 */
export const PRICE_BAND_SQL = `CASE
      WHEN l.price < 5000 THEN '0-5000'
      WHEN l.price < 20000 THEN '5000-20000'
      WHEN l.price < 50000 THEN '20000-50000'
      ELSE '50000-'
    END`;

/** A fragment plus the values its placeholders refer to. */
export type SqlFragment = { text: string; values: unknown[] };

/**
 * Builds the shared WHERE clause. Each filter is independent and skipped when
 * absent, which is what lets the UI clear one without disturbing the others.
 *
 * `startIndex` is the number of parameters already bound by the caller, so
 * placeholder numbering continues rather than restarting at $1.
 */
export function buildListingWhere(
  filters: ListingFilters,
  startIndex = 0,
): SqlFragment {
  const clauses: string[] = ["l.status = 'active'"];
  const values: unknown[] = [];
  const next = () => `$${startIndex + values.length}`;

  // = ANY(array) rather than IN (...), same reasoning as conditions below: one
  // placeholder covers any number of selected categories.
  if (filters.categorySlugs && filters.categorySlugs.length > 0) {
    values.push(filters.categorySlugs);
    clauses.push(`l.category_slug = ANY(${next()}::text[])`);
  }

  if (filters.subcategorySlug) {
    values.push(filters.subcategorySlug);
    clauses.push(`l.subcategory_slug = ${next()}`);
  }

  if (filters.audience) {
    values.push(filters.audience);
    clauses.push(`l.audience = ${next()}::listing_audience`);
  }

  if (filters.cities && filters.cities.length > 0) {
    values.push(filters.cities);
    clauses.push(`l.city = ANY(${next()}::text[])`);
  }

  // = ANY(array) rather than IN (...), so one placeholder covers any number of
  // selected conditions and the statement text stays stable for the planner.
  if (filters.conditions && filters.conditions.length > 0) {
    values.push(filters.conditions);
    clauses.push(`l.condition = ANY(${next()}::listing_condition[])`);
  }

  if (filters.sizes && filters.sizes.length > 0) {
    values.push(filters.sizes);
    clauses.push(`l.size = ANY(${next()}::text[])`);
  }

  if (filters.colours && filters.colours.length > 0) {
    values.push(filters.colours);
    clauses.push(`l.colour = ANY(${next()}::text[])`);
  }

  if (filters.priceBands && filters.priceBands.length > 0) {
    values.push(filters.priceBands);
    clauses.push(`(${PRICE_BAND_SQL}) = ANY(${next()}::text[])`);
  }

  if (filters.minPrice !== undefined) {
    values.push(filters.minPrice);
    clauses.push(`l.price >= ${next()}`);
  }

  if (filters.maxPrice !== undefined) {
    values.push(filters.maxPrice);
    clauses.push(`l.price <= ${next()}`);
  }

  if (filters.postedWithinDays !== undefined) {
    values.push(filters.postedWithinDays);
    clauses.push(`l.posted_at >= now() - (${next()} || ' days')::interval`);
  }

  return { text: clauses.join("\n       AND "), values };
}

/**
 * ORDER BY for a sort key. Every option ends in a unique column so the order is
 * total: without that tiebreaker, rows with equal price or timestamp could swap
 * places between requests and a keyset cursor would skip or repeat them.
 */
export function buildOrderBy(sort: SortKey, hasQuery: boolean): string {
  switch (sort) {
    case "price_asc":
      return "l.price ASC, l.id ASC";
    case "price_desc":
      return "l.price DESC, l.id DESC";
    case "newest":
      return "l.posted_at DESC, l.id DESC";
    case "relevance":
    default:
      // Ranking is meaningless without a query, so fall back to newest.
      return hasQuery
        ? "rank DESC, l.posted_at DESC, l.id DESC"
        : "l.posted_at DESC, l.id DESC";
  }
}

/**
 * The rank expression. Weights come from the generated tsvector: title is 'A'
 * and description 'B', so a title hit outranks the same word in a description.
 * Selected as a constant 0 when there is no query, keeping one column list for
 * both paths.
 *
 * Rounded to a `numeric` rather than left as `ts_rank`'s native `real`: a
 * one-word query ties enormous numbers of rows on essentially the same
 * `real` value (see the relevance-clause comment further up this file), and
 * a keyset cursor's rank travels through a text/JSON round trip before
 * coming back as a query parameter. Comparing that reconstructed value
 * against a freshly-recomputed `real` at the tied boundary — which is what
 * `prev` pagination lands on — could disagree at the level of float
 * precision, stranding the whole tied cluster and returning zero rows even
 * though hundreds of matching listings sit right at that boundary. Rounding
 * to 6 decimal places on both sides (here, and in the cursor's `::numeric`
 * cast below) collapses that ambiguity: `numeric` compares as exact decimal,
 * not binary float, so the same rounded value always reproduces itself
 * exactly through the cursor round trip.
 */
export const RANK_EXPRESSION = `round(ts_rank(l.search_vector, websearch_to_tsquery('english', $1))::numeric, 6)`;

/**
 * PAGINATION, explained: a simple way to paginate is `LIMIT 24 OFFSET 480`
 * ("skip the first 480 rows, then give me 24") for page 21. The problem: to
 * skip 480 rows, Postgres still has to walk through all of them first — so
 * page 500 gets slower and slower the deeper it goes, at 100,000+ rows.
 *
 * This app uses a "cursor" (also called "keyset pagination") for Next/Previous
 * instead: rather than saying "skip 480 rows," it remembers the sort values
 * of the *last row already shown* — e.g. "the last listing was posted at
 * 2pm and has id 4821" — and asks Postgres for "the next rows after that
 * point," which an index can jump straight to, regardless of how deep into
 * the results that is. `Cursor` below is exactly that remembered position.
 *
 * The tiebreaker values of one row, in the order its sort's ORDER BY uses them.
 * Enough to resume immediately after (or before) that row without OFFSET.
 *
 * `id` is always present — every sort ends on it, which is what keeps a keyset
 * seek unambiguous even when every other column ties. `rank` and `price` are
 * mutually exclusive with each other and with being absent, one per sort family.
 */
export type Cursor = {
  rank?: number;
  postedAt?: string;
  price?: number;
  id: string;
};

// The cursor is sent to the browser as part of the API response (as
// "nextCursor"/"prevCursor") and comes back on the next request — so it has
// to travel as plain text in a URL. JSON.stringify turns the Cursor object
// into text, and base64url encoding turns that text into a URL-safe string
// with no spaces or special characters. It isn't encryption — anyone could
// decode it — but nothing about a cursor is secret; it just remembers a
// position in an already-public list of listings.
/** Opaque to the client on purpose — nothing but this module parses it. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** `null` on anything malformed, so a tampered or stale cursor degrades to "start over" rather than a 500. */
export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Cursor).id === "string"
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads the cursor tuple off a result row, in the shape its sort produced it.
 * The mirror of `buildKeysetClause` below — same three sort families.
 */
export function cursorFromRow(
  row: { id: string; posted_at: Date; price: string },
  sort: SortKey,
  hasQuery: boolean,
  rank?: number,
): Cursor {
  if (sort === "price_asc" || sort === "price_desc") {
    return { price: Number(row.price), id: row.id };
  }
  if (sort === "relevance" && hasQuery) {
    return { rank, postedAt: row.posted_at.toISOString(), id: row.id };
  }
  return { postedAt: row.posted_at.toISOString(), id: row.id };
}

/**
 * A keyset ("seek") WHERE fragment: the set of rows immediately after (or
 * before) one already-seen row, expressed as a single row-constructor
 * comparison so Postgres can satisfy it with the same composite index that
 * already backs the ORDER BY — no OFFSET, so the cost does not grow with how
 * deep into the result set that row was.
 *
 * `direction: "next"` walks the same way the sort already reads (the next
 * page). `"prev"` walks backward: the comparison and the ORDER BY it must be
 * paired with (see `keysetOrderBy`) are both reversed, so the *closest*
 * preceding rows come back first under LIMIT — the repository then reverses
 * the array once in memory to restore display order. Two round trips through
 * the same index, never a scan proportional to position.
 */
export function buildKeysetClause(
  sort: SortKey,
  hasQuery: boolean,
  cursor: Cursor,
  direction: "next" | "prev",
  startIndex: number,
): SqlFragment | null {
  const forward = direction === "next";

  if (sort === "price_asc" || sort === "price_desc") {
    if (cursor.price === undefined) return null;
    const op = (sort === "price_asc") === forward ? ">" : "<";
    return {
      text: `(l.price, l.id) ${op} ($${startIndex + 1}::numeric, $${startIndex + 2}::bigint)`,
      values: [cursor.price, cursor.id],
    };
  }

  if (sort === "relevance" && hasQuery) {
    if (cursor.rank === undefined || cursor.postedAt === undefined) return null;
    const op = forward ? "<" : ">";
    // `::numeric`, matching RANK_EXPRESSION's own rounding — see its comment
    // for why comparing as exact decimal rather than binary float is what
    // keeps a tied-rank boundary from stranding a `prev` seek.
    return {
      text: `(${RANK_EXPRESSION}, l.posted_at, l.id) ${op} ($${startIndex + 1}::numeric, $${startIndex + 2}::timestamptz, $${startIndex + 3}::bigint)`,
      values: [cursor.rank, cursor.postedAt, cursor.id],
    };
  }

  // "newest", and "relevance" without a query (which sorts the same way).
  if (cursor.postedAt === undefined) return null;
  const op = forward ? "<" : ">";
  return {
    text: `(l.posted_at, l.id) ${op} ($${startIndex + 1}::timestamptz, $${startIndex + 2}::bigint)`,
    values: [cursor.postedAt, cursor.id],
  };
}

/**
 * The ORDER BY a keyset seek must run under: `buildOrderBy`'s own order when
 * walking forward, flipped end-to-end when walking backward. Pairs with
 * `buildKeysetClause`'s comparison flip — together they turn "the closest
 * rows before this one" into "the first rows LIMIT returns", which is what
 * makes a backward seek just as index-friendly as a forward one.
 */
export function keysetOrderBy(
  sort: SortKey,
  hasQuery: boolean,
  direction: "next" | "prev",
): string {
  const order = buildOrderBy(sort, hasQuery);
  if (direction === "next") return order;

  return order
    .split(", ")
    .map((column) => (column.endsWith(" DESC") ? column.replace(" DESC", " ASC") : column.replace(" ASC", " DESC")))
    .join(", ");
}

/** Columns every result row needs, including the primary photo. */
export const LISTING_COLUMNS = `
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
  -- The thumbnail generated at upload time; falls back to the full-size
  -- photo for every row with none (every seeded row, and anything uploaded
  -- before thumbnails existed) — see upload.middleware.ts.
  COALESCE(photo.thumb_path, photo.path) AS image
`;

/**
 * Joins used by the exact search. The photo comes from a LATERAL subquery so
 * a page of results costs one query rather than one per row.
 */
export const LISTING_JOINS = `
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
