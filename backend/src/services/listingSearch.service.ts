/**
 * Search orchestration: runs the exact search, falls back to fuzzy on a miss,
 * and shapes rows into the API's response.
 */
import {
  countSearchMatches,
  fetchFacetCounts,
  searchListingsExact,
  searchListingsFuzzy,
  suggestCategories,
  suggestCorrection,
  type CursorSeek,
  type FacetCountRow,
  type SearchRow,
} from "../repositories/listingSearch.repository";
import {
  cursorFromRow,
  decodeCursor,
  encodeCursor,
  type SortKey,
} from "../db/queries/listingSearch.sql";
import type { FacetKey } from "../db/queries/listingFacets.sql";
import { resolveImagePath } from "../utils/images";
import type {
  ListingDTO,
  ListingFacetsDTO,
  ListingSearchDTO,
} from "../types/dto";

const PLACEHOLDER_IMAGE = "/images/product-slim-fit-tee.jpg";

export type SearchRequest = {
  q?: string;
  categorySlugs?: string[];
  subcategorySlug?: string;
  audience?: string;
  cities?: string[];
  conditions?: string[];
  sizes?: string[];
  colours?: string[];
  priceBands?: string[];
  minPrice?: number;
  maxPrice?: number;
  postedWithinDays?: number;
  sort: SortKey;
  page: number;
  perPage: number;
  /** Opaque token from a previous response's `nextCursor`/`prevCursor`. */
  cursor?: string;
  cursorDir?: "next" | "prev";
  /**
   * Echoed back from page 1's own response — see the fuzzy-fallback comment
   * below for why a later page needs to be told, rather than deciding fresh.
   */
  fuzzy?: boolean;
};

/**
 * Folds the flat rows from the facet query into one array per group.
 *
 * Every group is present even when empty, so the UI can render a filter list
 * that is simply empty rather than having to guard against a missing key.
 */
function groupFacets(rows: FacetCountRow[]): ListingFacetsDTO {
  const grouped: ListingFacetsDTO = {
    category: [],
    audience: [],
    city: [],
    condition: [],
    size: [],
    colour: [],
    price: [],
  };

  for (const row of rows) {
    const group = grouped[row.facet as FacetKey];
    // Ignore anything the query grew that this version does not know about.
    if (!group) continue;

    group.push({
      value: row.value,
      label: row.label ?? row.value,
      count: Number(row.total),
    });
  }

  return grouped;
}

const toDTO = (row: {
  id: string;
  title: string;
  category_slug: string;
  category_label: string;
  audience: string;
  brand: string | null;
  size: string | null;
  colour: string | null;
  condition: string;
  price: string;
  city: string;
  location: string | null;
  posted_at: Date;
  image: string | null;
}): ListingDTO => ({
  id: row.id,
  title: row.title,
  category: row.category_slug,
  categoryLabel: row.category_label,
  audience: row.audience,
  brand: row.brand,
  size: row.size,
  colour: row.colour,
  condition: row.condition,
  price: Number(row.price),
  city: row.city,
  location: row.location,
  postedAt: row.posted_at.toISOString(),
  image: resolveImagePath(row.image ?? PLACEHOLDER_IMAGE),
});

/**
 * A type-ahead suggestion — a category or subcategory to navigate into, not a
 * listing. `subcategorySlug`/`subcategoryLabel` are null for a top-level
 * category match; when present, `categorySlug`/`categoryLabel` are that
 * subcategory's *parent*, so the pair maps directly onto
 * `/search?category=&subcategory=`.
 */
export type SuggestionDTO = {
  categorySlug: string;
  categoryLabel: string;
  subcategorySlug: string | null;
  subcategoryLabel: string | null;
};

/**
 * Type-ahead suggestions for a partial query — which category/subcategory it
 * most likely means, not a list of matching listings. See `suggestCategories`
 * for how a term with no literal category name (e.g. "shoes", filed under
 * "Footwear") still resolves correctly.
 *
 * Kept separate from `searchListings` rather than reusing it with a small
 * `perPage`: a search runs the count and every facet alongside the page of
 * results, and none of that is wanted for a dropdown that fires while someone is
 * still typing. These are small, indexed queries, cheap enough to run per
 * keystroke-after-debounce.
 */
export async function suggestSearches(
  q: string,
  limit?: number,
): Promise<SuggestionDTO[]> {
  const rows = await suggestCategories(q, limit);

  return rows.map((row) => ({
    categorySlug: row.categorySlug,
    categoryLabel: row.categoryLabel,
    subcategorySlug: row.subcategorySlug,
    subcategoryLabel: row.subcategoryLabel,
  }));
}

/**
 * This is the main search function — the controller calls this one function,
 * and it's responsible for producing everything a search results page needs
 * in one go: the page of listings, the total count (for "1,234 results" and
 * page numbers), the facet counts (the numbers next to each filter checkbox),
 * and — only when needed — a typo correction.
 *
 * In plain terms, what happens inside:
 *   1. Try an exact search (real words matching the listing's title/description).
 *   2. If that finds nothing at all AND the shopper typed something, try again
 *      with typo-tolerant matching instead (so "bycicle" still finds bicycles).
 *   3. Also work out the total count and the filter counts, in parallel with
 *      the above rather than after it, since none of them depend on each other.
 *   4. If someone asked for a page number that doesn't exist (e.g. page 50 of
 *      a 3-page result), quietly give them the last real page instead of an
 *      empty one.
 *   5. Package everything into the shape the frontend expects and return it.
 *
 * "One page of search results." Tries tsquery first (Postgres's real
 * full-text search). If a query was supplied and matched nothing, retries with
 * trigram similarity (typo-tolerant matching) and flags the response as fuzzy,
 * so the UI can say results are approximate and offer a correction.
 */
export async function searchListings(
  request: SearchRequest,
): Promise<ListingSearchDTO> {
  const perPage = Math.min(Math.max(request.perPage, 1), 60);
  const requestedPage = Math.max(request.page, 1);
  const offset = (requestedPage - 1) * perPage;

  /* A cursor is only trusted when it actually decodes and carries the fields
     this sort needs (see `buildKeysetClause`) — anything else, including one
     left over from a different sort after the shopper changed it, quietly
     falls back to `offset` below rather than 400ing or serving nonsense. */
  const seek: CursorSeek | null =
    request.cursor && request.cursorDir
      ? (() => {
          const cursor = decodeCursor(request.cursor!);
          return cursor ? { cursor, direction: request.cursorDir! } : null;
        })()
      : null;

  const options = { ...request, limit: perPage, offset, seek };

  /* All three queries are dispatched together rather than the page first and the
     count/facets after it.

     They do not depend on each other — only on `fuzzy`, which is false for every
     search that matches something. So the count and facets are started
     optimistically on that assumption, and the endpoint costs one round trip
     instead of two. Over a link to the database that dominates: the queries
     themselves are milliseconds, the round trip is not.

     The bet is wrong only when a supplied query matches nothing, and the cost
     of losing it is two superseded queries whose results are dropped. Rare
     enough, and cheap enough, to be worth halving the latency of every search
     that does match. */
  const pageRows = searchListingsExact(options);
  const optimisticTotal = countSearchMatches({ ...request, fuzzy: false });
  const optimisticFacets = fetchFacetCounts({ ...request, fuzzy: false });

  let rows = await pageRows;
  let fuzzy = false;
  let suggestion: string | null = null;
  let total: number;
  let facetRows: FacetCountRow[];

  // Reach for the fuzzy path on a genuine miss on page 1, or when the client
  // already told us this search only ever matched via fuzzy (see `fuzzy` on
  // `SearchRequest`). That second condition is what keeps page 2 onward
  // working at all for a fuzzy-only search: without it, every page after the
  // first re-decides from scratch, sees the same exact-tsquery miss page 1
  // did, and — because "only reach for fuzzy on page 1" used to be
  // unconditional — silently gives up and returns zero results instead of
  // continuing the same result set. Restricting the *auto-detect* itself to
  // page 1 is still correct: a later page's own miss on tsquery must not
  // retry fuzzy independently, or two different pages of one search could
  // end up ranked by two different algorithms.
  if (rows.length === 0 && request.q && (requestedPage === 1 || request.fuzzy)) {
    /* Same bet as the exact-search fan-out above, one level deeper: the fuzzy
       page, its count, its facets and its "did you mean" all start together
       rather than the page first and the rest after it. Awaiting the page
       alone before starting the other three turned every fuzzy search into
       two sequential round trips instead of one — the fuzzy page itself
       costs as much as any of the other three, so that was doubling the
       floor, not adding a rounding error.

       The bet here is that the fuzzy page finds something, which is what
       "fuzzy" already meant before this change — a search this far in has
       already missed on tsquery, so a second miss (fuzzy also finding
       nothing) is rarer still, and its cost is the same three superseded
       queries the exact path already accepts losing. */
    const fuzzyRows = searchListingsFuzzy(options);
    const fuzzyTotal = countSearchMatches({ ...request, fuzzy: true });
    const fuzzyFacets = fetchFacetCounts({ ...request, fuzzy: true });
    const fuzzySuggestion = suggestCorrection(request.q);

    rows = await fuzzyRows;
    // A later page of an *already-known* fuzzy search (`request.fuzzy`) stays
    // fuzzy even when this particular page's rows come back empty — that
    // emptiness means "nothing at this offset" (a page past the real last
    // one, see the self-heal below), not "this search turned out not to be
    // fuzzy after all." Getting this wrong previously fell through to the
    // `else` branch below and reported the *exact*-match total (0, since an
    // exact-tsquery miss is what reached the fuzzy path to begin with)
    // instead of the real fuzzy total — which then also defeated the
    // self-heal, since it only runs when `total > 0`.
    fuzzy = rows.length > 0 || Boolean(request.fuzzy);

    if (fuzzy) {
      void optimisticTotal.catch(() => undefined);
      void optimisticFacets.catch(() => undefined);
      [total, facetRows, suggestion] = await Promise.all([
        fuzzyTotal,
        fuzzyFacets,
        fuzzySuggestion,
      ]);
    } else {
      void fuzzyTotal.catch(() => undefined);
      void fuzzyFacets.catch(() => undefined);
      void fuzzySuggestion.catch(() => undefined);
      [total, facetRows] = await Promise.all([optimisticTotal, optimisticFacets]);
    }
  } else {
    [total, facetRows] = await Promise.all([optimisticTotal, optimisticFacets]);
  }

  /**
   * A third tier, past exact and fuzzy: the query itself matched no title
   * and no description at all — not a typo (fuzzy already ruled that out),
   * a genuine vocabulary gap. "mobile" is the case that motivated this: no
   * phone listing's title or description ever says the word "mobile" (they
   * name a brand and model instead), so tsquery and trigram both miss, even
   * though the *category* is named exactly that. Reuses the same
   * label-matching lookup the type-ahead dropdown already uses for "mob" ->
   * "Mobiles", so a query that literally names a category or subcategory
   * still lands somewhere instead of a bare "no results" — no separate
   * synonym table to maintain.
   *
   * Only attempted on page 1 of a query that missed completely (`total`
   * reaching 0 here means the exact search's own count agreed there was
   * nothing, and `!fuzzy` means the fuzzy attempt above didn't find anything
   * either) — the same "auto-detect once, not on every page" rule the fuzzy
   * fallback follows above, for the same reason: a later page must not
   * re-decide the search algorithm independently of page 1.
   */
  let categoryFallback: ListingSearchDTO["categoryFallback"] = null;
  if (request.q && rows.length === 0 && total === 0 && !fuzzy && requestedPage === 1 && !seek) {
    const [match] = await suggestCategories(request.q, 1);
    if (match) {
      const fallbackOptions = {
        ...options,
        q: undefined,
        categorySlugs: [match.categorySlug],
        subcategorySlug: match.subcategorySlug ?? undefined,
        offset: 0,
        seek: null,
      };
      const [fallbackRows, fallbackTotal, fallbackFacets] = await Promise.all([
        searchListingsExact(fallbackOptions),
        countSearchMatches({ ...fallbackOptions, fuzzy: false }),
        fetchFacetCounts({ ...fallbackOptions, fuzzy: false }),
      ]);
      rows = fallbackRows;
      total = fallbackTotal;
      facetRows = fallbackFacets;
      categoryFallback = {
        categorySlug: match.categorySlug,
        categoryLabel: match.categoryLabel,
        subcategorySlug: match.subcategorySlug,
        subcategoryLabel: match.subcategoryLabel,
      };
    }
  }

  // A page past the last real one comes back with no rows even though
  // `total` said matches exist — self-heal by checking reality again right
  // now, rather than trusting the count from a moment ago.
  //
  // This is not only "someone hand-typed a page number past the end."
  // `total` and this page's rows are two separate queries, dispatched
  // together and each reading its own snapshot of a table that is never
  // still — 100k+ listings, an expiry sweep every five minutes, sellers
  // editing/selling/deleting continuously. The two can legitimately
  // disagree by the time both finish, and that gap is not proportional to
  // how deep into the results the page is: it can land on *any* page,
  // including one equal to (not just past) the `total`-implied last page —
  // which a check of `requestedPage > pageCount` alone would miss, because
  // on the exact last page those two are equal by definition. The fix is to
  // treat "rows came back empty despite a nonzero total" as the signal,
  // re-count for what is true *now*, and land on whatever page that current
  // truth says is last — rather than assume the original `total` was ever
  // wrong, or that the requested page was necessarily invalid.
  //
  // Also covers a cursor (`seek`) request coming back empty. The comment
  // above once assumed that could only mean "nothing more in that
  // direction" — a button the client should have already disabled — but a
  // cursor can legitimately fail to find any rows despite `total` being
  // correct (e.g. a relevance-sort tie-break landing on a boundary a
  // recomputed value doesn't exactly reproduce), so an empty seek result
  // gets the same fresh-reality check as an empty offset page, falling back
  // to a plain offset fetch of whatever page is actually last rather than
  // handing the client a confident-looking `total`/`hasMore` alongside zero
  // rows.
  let page = categoryFallback ? 1 : requestedPage;
  if (rows.length === 0 && total > 0) {
    const freshTotal = await countSearchMatches({ ...request, fuzzy });
    total = freshTotal;
    if (freshTotal > 0) {
      page = Math.min(requestedPage, Math.max(1, Math.ceil(freshTotal / perPage)));
      // Must match whichever path produced `total` — an exact-tsquery
      // re-fetch here for a fuzzy search would just repeat the exact-match
      // miss that reached the fuzzy path in the first place, landing back on
      // an empty page despite a correct, nonzero `total`. Dropping `seek`
      // (not just adding `offset`) is what forces this back onto the
      // offset path even when the original request was a cursor seek.
      const healedOptions = {
        ...options,
        seek: null,
        offset: (page - 1) * perPage,
      };
      rows = fuzzy
        ? await searchListingsFuzzy(healedOptions)
        : await searchListingsExact(healedOptions);
    }
  }

  // A category-fallback result was fetched with no text query at all (see
  // above) — its rows carry no rank to put in a cursor, whatever `request.q`
  // itself still says.
  const hasQuery = Boolean(request.q) && !categoryFallback;
  const first = rows[0] as SearchRow | undefined;
  const last = rows[rows.length - 1] as SearchRow | undefined;
  const nextCursor = last
    ? encodeCursor(cursorFromRow(last, request.sort, hasQuery, Number(last.rank)))
    : null;
  const prevCursor = first
    ? encodeCursor(cursorFromRow(first, request.sort, hasQuery, Number(first.rank)))
    : null;

  return {
    items: rows.map(toDTO),
    total,
    page,
    perPage,
    hasMore: page * perPage < total,
    // No further page exists once the last row is on screen; a cursor is
    // only worth handing back when there is somewhere left for it to go.
    nextCursor: page * perPage < total ? nextCursor : null,
    prevCursor: page > 1 ? prevCursor : null,
    sort: request.sort,
    fuzzy,
    suggestion,
    categoryFallback,
    facets: groupFacets(facetRows),
  };
}
