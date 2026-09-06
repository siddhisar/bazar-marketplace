/**
 * This is a "repository" file — the only layer in this backend that writes
 * actual SQL and sends it to PostgreSQL. Controllers and services never talk
 * to the database directly; they call functions here instead. Keeping all
 * the SQL in one place (per feature) makes it much easier to see exactly
 * what data comes from where, and to tune performance (indexes, query
 * shape) without touching business logic elsewhere.
 *
 * Every query below uses "parameterized SQL" — instead of building a query
 * by joining strings together (which is how SQL injection attacks happen),
 * values are sent separately from the SQL text as $1, $2, $3, ... placeholders,
 * and the `pg` database driver combines them safely. For example:
 *
 *   query("SELECT * FROM users WHERE email = $1", [userInput])
 *
 * Here, `userInput` can never be interpreted as SQL — even if someone types
 * `'; DROP TABLE users; --` into a form, it is only ever treated as a plain
 * string to compare against, never as part of the query's structure. This
 * matters most for search, because a search box is the most obvious place to
 * try a SQL injection attack.
 *
 * Listing search against Postgres full-text search, with a trigram fallback for
 * misspelled queries.
 */
import { query } from "../config/database";
import {
  buildListingWhere,
  buildKeysetClause,
  buildOrderBy,
  exactRelevanceClause,
  fuzzyRelevanceClause,
  keysetOrderBy,
  LISTING_COLUMNS,
  LISTING_JOINS,
  RANK_EXPRESSION,
  type Cursor,
  type ListingFilters,
  type SortKey,
} from "../db/queries/listingSearch.sql";
import { buildFacetCountsQuery } from "../db/queries/listingFacets.sql";
import type { ListingRow } from "./marketplace.repository";

export type SearchRow = ListingRow & { rank: string };

/** A resume point plus which way to walk from it — see `buildKeysetClause`. */
export type CursorSeek = { cursor: Cursor; direction: "next" | "prev" };

export type SearchOptions = ListingFilters & {
  sort: SortKey;
  limit: number;
  offset: number;
  /**
   * When present, rows are fetched by seeking from this cursor instead of
   * OFFSET — the fix for "page 500 must return as quickly as page 2": a seek
   * costs one index descent regardless of how deep the cursor is, where
   * OFFSET costs work proportional to `offset`. Absent on the first page of a
   * search (nothing to resume from) and on a hand-edited `?page=N` jump,
   * both of which still use `offset` below.
   */
  seek?: CursorSeek | null;
};

/**
 * Runs the real full-text search and returns one page of matching listings.
 *
 * "Full-text search" means Postgres doesn't just check if the search text
 * appears somewhere in the title — it understands words. `search_vector` is
 * a special column (built automatically from the title and description,
 * see marketplace.sql) that Postgres can search very fast using an index,
 * the same way a book's index lets you jump straight to a topic instead of
 * reading every page. `websearch_to_tsquery('english', $1)` turns the raw
 * text someone typed into a search Postgres understands — plurals, common
 * word endings, and multiple words are all handled by Postgres itself, using
 * English-language rules.
 *
 * Returns rows ordered by the requested sort (relevance, newest, or price).
 *
 * The query text is only bound when there is one: an unreferenced parameter
 * makes Postgres reject the statement with "could not determine data type of
 * parameter $1", since nothing in the SQL tells it what type to expect.
 */
export async function searchListingsExact(
  options: SearchOptions,
): Promise<SearchRow[]> {
  const hasQuery = Boolean(options.q);
  const values: unknown[] = hasQuery ? [options.q] : [];

  const where = buildListingWhere(options, values.length);
  values.push(...where.values);

  const textClause = hasQuery
    ? `AND l.search_vector @@ websearch_to_tsquery('english', $1)
       AND ${exactRelevanceClause("$1")}`
    : "";

  const seekClause =
    options.seek &&
    buildKeysetClause(
      options.sort,
      hasQuery,
      options.seek.cursor,
      options.seek.direction,
      values.length,
    );

  let sql: string;
  if (seekClause) {
    values.push(...seekClause.values);
    values.push(options.limit);
    sql = `SELECT ${LISTING_COLUMNS},
            ${hasQuery ? RANK_EXPRESSION : "0"} AS rank
     ${LISTING_JOINS}
     WHERE ${where.text}
       ${textClause}
       AND ${seekClause.text}
     ORDER BY ${keysetOrderBy(options.sort, hasQuery, options.seek!.direction)}
     LIMIT $${values.length}`;
  } else {
    values.push(options.limit, options.offset);
    const limitPlaceholder = `$${values.length - 1}`;
    const offsetPlaceholder = `$${values.length}`;
    sql = `SELECT ${LISTING_COLUMNS},
            ${hasQuery ? RANK_EXPRESSION : "0"} AS rank
     ${LISTING_JOINS}
     WHERE ${where.text}
       ${textClause}
     ORDER BY ${buildOrderBy(options.sort, hasQuery)}
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;
  }

  const { rows } = await query<SearchRow>(sql, values);

  // A backward seek runs under the reversed ORDER BY so LIMIT takes the rows
  // *closest* to the cursor — restoring display order means reversing once
  // more here, in memory, rather than a second index walk.
  if (seekClause && options.seek!.direction === "prev") rows.reverse();

  return rows;
}

/**
 * Fallback for when the exact search finds nothing: "bycicle" produces no
 * lexeme that matches "bicycle", so tsquery cannot help. Trigram similarity on
 * the raw title can, backed by the GIN index on `title gin_trgm_ops`.
 *
 * Only run after an exact miss — it is the more expensive path, and running it
 * on every search would spend that cost on the majority of queries that do not
 * need it.
 *
 * Ranks, then joins — not the other way round. Joining category/photo inline
 * (as `LISTING_JOINS` does, and as this query used to) forces Postgres to run
 * both joins — including the per-row `LATERAL` photo lookup — against every
 * row the trigram index returns before the `ORDER BY ... LIMIT` can discard
 * the ones that don't make the page: measured at ~1,085 ms for "bycicle"
 * against this dataset (thousands of trigram candidates, each joined, only
 * 24 kept). Resolving rank and applying `LIMIT` first, in a CTE over `listings`
 * alone, then joining only the resulting page — the exact same rows, same
 * order, verified — measured ~112 ms. Not applied to the exact-match path:
 * that one was already within budget, and touching a working query for a
 * theoretical gain is a bad trade this close to a deadline.
 */
export async function searchListingsFuzzy(
  options: SearchOptions,
): Promise<SearchRow[]> {
  if (!options.q) return [];

  const values: unknown[] = [options.q];
  const where = buildListingWhere(options, values.length);
  values.push(...where.values);

  values.push(options.limit, options.offset);
  const limitPlaceholder = `$${values.length - 1}`;
  const offsetPlaceholder = `$${values.length}`;

  // `<%` is word similarity: it compares the query against the closest *word*
  // in the title, not the whole string. Plain `%` compares entire strings, so
  // "hoodei" scored far below the threshold against "Pepe Jeans Zip Hoodie" and
  // only short titles ever matched. Both operators use the same GIN trigram
  // index on title.
  //
  // `<%` alone is a loose, fixed, database-wide prefilter — good for using the
  // index cheaply, not for deciding what's actually relevant. At this table's
  // size, that looseness lets thousands of unrelated titles through purely by
  // coincidental trigram overlap (see `fuzzyRelevanceClause`), so a second,
  // per-query condition narrows the indexed candidates down to only the ones
  // reasonably close to the *best* match this specific search found.
  const { rows } = await query<SearchRow>(
    `WITH ranked AS (
       SELECT l.id, l.title, l.category_slug, l.audience, l.brand, l.size,
              l.colour, l.condition, l.price, l.city, l.location, l.posted_at,
              word_similarity($1, l.title) AS rank
       FROM listings l
       WHERE ${where.text}
         AND $1 <% l.title
         AND ${fuzzyRelevanceClause("$1")}
       ORDER BY rank DESC, l.posted_at DESC, l.id DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
     )
     SELECT ranked.id::text,
            ranked.title,
            ranked.category_slug,
            c.label AS category_label,
            ranked.audience,
            ranked.brand,
            ranked.size,
            ranked.colour,
            ranked.condition::text,
            ranked.price,
            ranked.city,
            ranked.location,
            ranked.posted_at,
            COALESCE(photo.thumb_path, photo.path) AS image,
            ranked.rank
     FROM ranked
     JOIN listing_categories c ON c.slug = ranked.category_slug
     LEFT JOIN LATERAL (
       SELECT path, thumb_path
       FROM listing_photos
       WHERE listing_id = ranked.id
       ORDER BY is_primary DESC, position ASC
       LIMIT 1
     ) AS photo ON true
     ORDER BY ranked.rank DESC, ranked.posted_at DESC, ranked.id DESC`,
    values,
  );

  return rows;
}

/**
 * Total matches for the same filters, used for result counts and page numbers.
 * `fuzzy` must match whichever path produced the rows or the count will not
 * agree with them.
 */
export async function countSearchMatches(
  options: ListingFilters & { fuzzy?: boolean },
): Promise<number> {
  const hasQuery = Boolean(options.q);
  // Same reason as above: bind the query text only when the SQL references it.
  const values: unknown[] = hasQuery ? [options.q] : [];

  const where = buildListingWhere(options, values.length);
  values.push(...where.values);

  const textClause = !hasQuery
    ? ""
    : options.fuzzy
      ? `AND $1 <% l.title AND ${fuzzyRelevanceClause("$1")}`
      : `AND l.search_vector @@ websearch_to_tsquery('english', $1)
         AND ${exactRelevanceClause("$1")}`;

  const { rows } = await query<{ total: string }>(
    `SELECT count(*)::text AS total
     FROM listings l
     WHERE ${where.text}
       ${textClause}`,
    values,
  );

  return Number(rows[0]?.total ?? 0);
}

/** One facet group's value: `{ facet: "colour", value: "Black", total: "312" }`. */
export type FacetCountRow = {
  facet: string;
  value: string;
  label: string | null;
  /** bigint, so node-postgres hands it back as a string. */
  total: string;
};

/**
 * Every facet count for the current filters, in one round trip.
 *
 * See buildFacetCountsQuery for why each facet excludes its own filter and how
 * one statement covers all six groups.
 */
export async function fetchFacetCounts(
  options: ListingFilters & { fuzzy?: boolean },
): Promise<FacetCountRow[]> {
  const { text, values } = buildFacetCountsQuery(options, {
    fuzzy: options.fuzzy,
  });

  const { rows } = await query<FacetCountRow>(text, values);
  return rows;
}

/** One row from either candidate query below — a category or a subcategory. */
type CategoryMatchRow = {
  slug: string;
  label: string;
  parent_slug: string | null;
  parent_label: string | null;
};

/**
 * A suggestion the search box can offer: a category, or a subcategory (in
 * which case `categorySlug` is its *parent's* slug, so the pair is exactly
 * what `/search?category=&subcategory=` needs — see SearchBar's onPick).
 */
export type CategorySuggestion = {
  categorySlug: string;
  categoryLabel: string;
  subcategorySlug: string | null;
  subcategoryLabel: string | null;
};

/** Under this, a single letter matches most of the taxonomy and the list would be noise. */
const MIN_SUGGEST_QUERY_LENGTH = 2;

const toSuggestion = (row: CategoryMatchRow): CategorySuggestion =>
  row.parent_slug
    ? {
        categorySlug: row.parent_slug,
        categoryLabel: row.parent_label ?? row.parent_slug,
        subcategorySlug: row.slug,
        subcategoryLabel: row.label,
      }
    : {
        categorySlug: row.slug,
        categoryLabel: row.label,
        subcategorySlug: null,
        subcategoryLabel: null,
      };

/**
 * Type-ahead suggestions for a partial query — category/subcategory
 * navigation, not individual listings. Typing "shirt" should offer "Men's
 * Fashion → Shirts" to click into, not a list of listing titles to read one
 * by one; the titles themselves only make sense once inside a category, where
 * the existing filters/sort/pagination narrow them down.
 *
 * Two candidate sources, run together and merged here:
 *
 * 1. Direct label match — the query appears in a category or subcategory's
 *    own name ("car" → "Cars", "laptop" → "Laptops"). Cheap: the whole
 *    taxonomy is under 150 rows.
 *
 * 2. Listing-driven — the query has no literal category match ("shoes" is
 *    filed under "Footwear"; "iphone" isn't a category name at all), so this
 *    finds which category/subcategory the *listings* actually matching the
 *    query mostly belong to, via the same trigram-indexed ILIKE the old
 *    listing-title suggestions used. This is what makes the mapping work
 *    without hand-writing a synonym table: it reads the real taxonomy off
 *    the real data instead.
 *
 * Label matches are listed first (a name match is a stronger, cheaper signal
 * than an inference from listing content); duplicates are dropped by slug.
 *
 * @param q partial query; under two characters returns nothing.
 * @param limit how many suggestions to return, capped to keep the dropdown short.
 */
export async function suggestCategories(
  q: string,
  limit = 6,
): Promise<CategorySuggestion[]> {
  const trimmed = q.trim();
  if (trimmed.length < MIN_SUGGEST_QUERY_LENGTH) return [];

  const [labelMatches, listingMatches] = await Promise.all([
    query<CategoryMatchRow>(
      `SELECT c.slug, c.label, c.parent_slug, p.label AS parent_label
         FROM listing_categories c
         LEFT JOIN listing_categories p ON p.slug = c.parent_slug
        WHERE c.label ILIKE '%' || $1 || '%'
        ORDER BY (c.label ILIKE $1 || '%') DESC, length(c.label) ASC
        LIMIT 6`,
      [trimmed],
    ),
    query<CategoryMatchRow>(
      `SELECT c.slug, c.label, c.parent_slug, p.label AS parent_label
         FROM listings l
         JOIN listing_categories c ON c.slug = COALESCE(l.subcategory_slug, l.category_slug)
         LEFT JOIN listing_categories p ON p.slug = c.parent_slug
        WHERE l.status = 'active' AND l.title ILIKE '%' || $1 || '%'
        GROUP BY c.slug, c.label, c.parent_slug, p.label
        ORDER BY count(*) DESC
        LIMIT 6`,
      [trimmed],
    ),
  ]);

  const seen = new Set<string>();
  const merged: CategorySuggestion[] = [];
  for (const row of [...labelMatches.rows, ...listingMatches.rows]) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    merged.push(toSuggestion(row));
    if (merged.length >= Math.min(Math.max(limit, 1), 10)) break;
  }
  return merged;
}

/** Levenshtein distance, capped early since only small edits are worth ranking. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The closest existing word to a misspelled query, for a "did you mean"
 * prompt.
 *
 * Titles here are full phrases ("Kids Bicycle 20-inch — Barely Used"), and
 * `word_similarity` against the *whole title* — the previous approach —
 * regularly tied several unrelated titles at the same score (many phrases
 * score exactly 0.25 against a short typo, since the threshold search
 * space is wide), with no tiebreaker: `bycicle` could surface "Engineering
 * Mathematics by B.S. Grewal" as often as "Kids Bicycle...", depending on
 * scan order, not relevance.
 *
 * Fixed by keeping the trigram index for what it's good at — narrowing 90k+
 * rows to a small, plausible candidate set fast — and then resolving the
 * actual "closest word" question in Node, where a real edit distance can be
 * computed per *word* rather than per full title. The candidate pool (30
 * titles) is small enough that this costs nothing meaningful on top of the
 * indexed query itself.
 */
export async function suggestCorrection(q: string): Promise<string | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const { rows } = await query<{ title: string }>(
    `SELECT l.title
     FROM listings l
     WHERE l.status = 'active' AND $1 <% l.title
     ORDER BY word_similarity($1, l.title) DESC
     LIMIT 30`,
    [trimmed],
  );
  if (rows.length === 0) return null;

  const words = new Set<string>();
  for (const { title } of rows) {
    for (const word of title.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length > 2) words.add(word);
    }
  }

  const needle = trimmed.toLowerCase();
  let best: { word: string; distance: number } | null = null;
  for (const word of words) {
    const distance = editDistance(needle, word);
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && word < best.word) // deterministic tiebreak
    ) {
      best = { word, distance };
    }
  }

  return best?.word ?? null;
}
