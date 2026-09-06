/**
 * The shared search-state contract: types every filter/sort/page value, and
 * the URL <-> `SearchParams` round trip that makes a search bookmarkable,
 * shareable and reload-safe (see `paramsFromSearch`/`searchToParams` below).
 *
 * Matching, filtering, sorting, ranking and paging themselves happen in
 * Postgres — see `searchApi.ts`, which calls the real API and reshapes its
 * response into `SearchResult` below. This module used to also contain a
 * fixture implementation of all of that over mock data; it's gone (the
 * results page has used the real API exclusively for some time), but
 * `SearchResult.items` still names the fixture's `Listing` type as a shape
 * contract rather than duplicating it.
 */
import { CATEGORIES, type Listing } from "../data/marketplace";

/**
 * A readable fallback label for a subcategory slug, e.g.
 * "mens-fashion--mens-shirts" -> "Mens Shirts". Used where showing the
 * subcategory by name matters (a breadcrumb, a filter chip) but fetching its
 * real label would mean a second request just for display text — the slug
 * already carries enough to read sensibly.
 */
export function humanizeSubcategorySlug(slug: string): string {
  const own = slug.includes("--") ? slug.split("--").slice(1).join("--") : slug;
  return own
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type SortKey = "relevance" | "newest" | "price_asc" | "price_desc";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

export const POSTED_WITHIN_OPTIONS: { days: number; label: string }[] = [
  { days: 1, label: "Today" },
  { days: 3, label: "Last 3 days" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

/** Price bands shown as a facet, since a range slider cannot carry counts. */
export const PRICE_BANDS: { id: string; label: string; min?: number; max?: number }[] =
  [
    { id: "0-5000", label: "Under ₹5,000", max: 5000 },
    { id: "5000-20000", label: "₹5,000 – ₹20,000", min: 5000, max: 20000 },
    { id: "20000-50000", label: "₹20,000 – ₹50,000", min: 20000, max: 50000 },
    { id: "50000-", label: "Above ₹50,000", min: 50000 },
  ];

/**
 * The condition values the backend actually returns (see `listing_condition`
 * in the schema and the facet response) — used to validate a condition
 * arriving from the URL.
 */
const REAL_CONDITIONS = ["New with tags", "Like new", "Good", "Fair"];

export type SearchParams = {
  q: string;
  categories: string[];
  /** Only meaningful alongside exactly one selected category — its parent. */
  subcategory: string | null;
  cities: string[];
  conditions: string[];
  /**
   * Selected PRICE_BANDS ids — an alternative to a typed min/max, not a
   * further narrowing of it (same relationship as `categories`/`subcategory`):
   * picking any band clears whatever was typed, and vice versa.
   */
  priceBands: string[];
  minPrice: number | null;
  maxPrice: number | null;
  postedWithinDays: number | null;
  sort: SortKey;
  page: number;
  /**
   * A resume point from a previous response's `nextCursor`/`prevCursor`, so
   * Next/Previous can seek by index instead of by OFFSET — see
   * `Pagination.tsx`. `null` for a first load, a filter/sort change, or a
   * jump to a page not adjacent to the one just shown.
   */
  cursor: string | null;
  cursorDir: "next" | "prev" | null;
  /**
   * Whether this query only matches via typo-tolerant fuzzy search, echoed
   * back from the first page's own response (see `ApiSearchResult.fuzzy`)
   * and carried into later pages of the *same* search. Without this, page 2
   * of a fuzzy-only search re-decides from scratch, finds the same exact-text
   * miss page 1 did, and comes back empty even though page 1 just showed
   * results — the backend has no other way to know page 2 belongs to the
   * same fuzzy search rather than a fresh exact one.
   */
  fuzzy: boolean;
};

export const EMPTY_PARAMS: SearchParams = {
  q: "",
  categories: [],
  subcategory: null,
  cities: [],
  conditions: [],
  priceBands: [],
  minPrice: null,
  maxPrice: null,
  postedWithinDays: null,
  sort: "newest",
  page: 1,
  cursor: null,
  cursorDir: null,
  fuzzy: false,
};

export type FacetValue = { value: string; label: string; count: number };

export type Facets = {
  category: FacetValue[];
  city: FacetValue[];
  condition: FacetValue[];
  price: FacetValue[];
};

export type SearchResult = {
  items: Listing[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  facets: Facets;
  /** Closest real word to a query that matched nothing. */
  suggestion: string | null;
  /** Resume points for Next/Previous — see `SearchParams.cursor`. */
  nextCursor: string | null;
  prevCursor: string | null;
  /** True when this result came from typo-tolerant matching — see `SearchParams.fuzzy`. */
  fuzzy: boolean;
  /**
   * Set when the query matched no listing text at all but named a real
   * category/subcategory — see `ApiSearchResult.categoryFallback`. The
   * results page uses this once, right after the response arrives, to
   * redirect the URL to a plain category browse; nothing else reads it.
   */
  categoryFallback: {
    categorySlug: string;
    categoryLabel: string;
    subcategorySlug: string | null;
    subcategoryLabel: string | null;
  } | null;
};

/* -------------------------------------------------------------------------- */
/* URL state                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reads a search out of the query string.
 *
 * The URL is the single source of truth for a search, which is what makes a
 * result page bookmarkable, shareable and correct after a reload or a press of
 * the back button. Nothing about the current search is held anywhere else.
 */
export function paramsFromSearch(search: URLSearchParams): SearchParams {
  const number = (key: string): number | null => {
    const raw = search.get(key);
    if (raw === null || raw.trim() === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const sortRaw = search.get("sort") as SortKey | null;
  const validSort = SORT_OPTIONS.some((option) => option.value === sortRaw);
  const q = search.get("q")?.trim() ?? "";

  return {
    q,
    // Repeated keys, same as condition — one or many categories can be selected.
    categories: search.getAll("category"),
    // Only meaningful with exactly one category (see searchToParams).
    subcategory: search.get("subcategory"),
    // Repeated keys, same as category/condition — one or many cities.
    cities: search.getAll("city"),
    // Repeated keys, so a value containing a comma survives the round trip.
    // Validated against REAL_CONDITIONS (the backend's actual enum values)
    // above, so a condition arriving from a link, a reload, or the filter
    // checkboxes themselves is never silently dropped.
    conditions: search
      .getAll("condition")
      .filter((value) => REAL_CONDITIONS.includes(value)),
    // Repeated keys, same as category/condition. Validated against the real
    // band ids for the same reason conditions are validated above.
    priceBands: search
      .getAll("price")
      .filter((value) => PRICE_BANDS.some((band) => band.id === value)),
    minPrice: number("minPrice"),
    maxPrice: number("maxPrice"),
    postedWithinDays: number("postedWithin"),
    sort: validSort && sortRaw ? sortRaw : q ? "relevance" : "newest",
    page: number("page") ?? 1,
    cursor: search.get("cursor"),
    cursorDir: search.get("cursorDir") === "prev" ? "prev" : search.get("cursorDir") === "next" ? "next" : null,
    // Only meaningful with a query — carrying it into a query-less URL by
    // hand would just skip the (harmless, fast) exact-match attempt for no
    // reason, but never actually finding anything to be fuzzy about.
    fuzzy: q ? search.get("fuzzy") === "1" : false,
  };
}

/**
 * Writes a search into a query string.
 *
 * Defaults are omitted so a plain search produces a clean, shareable URL rather
 * than a wall of empty parameters.
 */
export function searchToParams(params: SearchParams): URLSearchParams {
  const search = new URLSearchParams();

  if (params.q) search.set("q", params.q);
  params.categories.forEach((value) => search.append("category", value));
  // Only meaningful with exactly one category selected — a subcategory
  // slug narrowing a browse across several categories at once would just
  // produce zero results, and picking a second category is what leaves
  // single-category browsing in the first place (see FilterSidebar).
  if (params.categories.length === 1 && params.subcategory) {
    search.set("subcategory", params.subcategory);
  }
  params.cities.forEach((value) => search.append("city", value));
  params.conditions.forEach((value) => search.append("condition", value));
  params.priceBands.forEach((value) => search.append("price", value));
  if (params.minPrice !== null) search.set("minPrice", String(params.minPrice));
  if (params.maxPrice !== null) search.set("maxPrice", String(params.maxPrice));
  if (params.postedWithinDays !== null) {
    search.set("postedWithin", String(params.postedWithinDays));
  }

  const defaultSort = params.q ? "relevance" : "newest";
  if (params.sort !== defaultSort) search.set("sort", params.sort);
  if (params.page > 1) search.set("page", String(params.page));
  if (params.cursor && params.cursorDir) {
    search.set("cursor", params.cursor);
    search.set("cursorDir", params.cursorDir);
  }
  // Only meaningful alongside a query — see the matching guard in
  // paramsFromSearch.
  if (params.q && params.fuzzy) search.set("fuzzy", "1");

  return search;
}

/** Human labels for the applied-filter chips, each with the key that clears it. */
export function describeFilters(
  params: SearchParams,
): { key: string; label: string }[] {
  const chips: { key: string; label: string }[] = [];

  params.categories.forEach((slug) => {
    const label = CATEGORIES.find((entry) => entry.slug === slug)?.label ?? slug;
    chips.push({ key: `category:${slug}`, label });
  });
  if (params.categories.length === 1 && params.subcategory) {
    chips.push({
      key: "subcategory",
      label: humanizeSubcategorySlug(params.subcategory),
    });
  }
  params.cities.forEach((value) => chips.push({ key: `city:${value}`, label: value }));
  params.conditions.forEach((value) =>
    chips.push({ key: `condition:${value}`, label: value }),
  );
  if (params.priceBands.length > 0) {
    params.priceBands.forEach((value) => {
      const label = PRICE_BANDS.find((entry) => entry.id === value)?.label ?? value;
      chips.push({ key: `price:${value}`, label });
    });
  } else if (params.minPrice !== null || params.maxPrice !== null) {
    chips.push({
      key: "price",
      label: `₹${params.minPrice ?? 0} – ${
        params.maxPrice === null ? "any" : `₹${params.maxPrice}`
      }`,
    });
  }
  if (params.postedWithinDays !== null) {
    const label =
      POSTED_WITHIN_OPTIONS.find(
        (entry) => entry.days === params.postedWithinDays,
      )?.label ?? "Recent";
    chips.push({ key: "postedWithin", label });
  }

  return chips;
}
