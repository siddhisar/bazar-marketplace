/**
 * This file turns the messy, all-strings URL query (`req.query`) into a
 * clean, typed object the rest of the backend can trust — the "backend
 * validation" step of the search flow.
 *
 * Why this needs to exist at all: everything in a URL arrives as text, or
 * arrays of text. `?page=2` arrives as the string `"2"`, not the number `2`.
 * `?condition=Good&condition=Fair` (the same key twice) arrives as an array.
 * A user could also type anything into the address bar, including nonsense
 * or something malicious. This file is the one place that turns "whatever
 * arrived" into "exactly what the search code expects," so nothing further
 * down has to re-check any of this.
 *
 * Everything here is defensive: values reach SQL as bind parameters regardless
 * (see db/queries/listingSearch.sql.ts for what that means and why it matters
 * for security), but rejecting nonsense early means a bad request is a 400 or
 * a sane default rather than a database error.
 */
import type { Request } from "express";
import type { SortKey } from "../db/queries/listingSearch.sql";
import type { SearchRequest } from "../services/listingSearch.service";

const SORTS = new Set<SortKey>(["relevance", "newest", "price_asc", "price_desc"]);
const AUDIENCES = new Set(["Men", "Women", "Unisex"]);
const CONDITIONS = new Set(["New with tags", "Like new", "Good", "Fair"]);
/** Must match PRICE_BAND_SQL's ids (db/queries/listingSearch.sql.ts) and the frontend's PRICE_BANDS (lib/search.ts). */
const PRICE_BAND_IDS = new Set(["0-5000", "5000-20000", "20000-50000", "50000-"]);

/** Longer than this is not a real search; trigram cost grows with length. */
const MAX_QUERY_LENGTH = 120;

/** No real size or colour is longer than this, or selected more times. */
const MAX_VALUE_LENGTH = 40;
const MAX_LIST_VALUES = 20;

const first = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
};

function parseNumber(value: unknown): number | undefined {
  const raw = first(value);
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(first(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Accepts repeated params or one comma-separated value.
 *
 * `allowed` restricts the result to a known set where one exists. Sizes and
 * colours are open-ended seed data rather than enums, so they are length-capped
 * instead — they still reach SQL as bind parameters either way.
 */
function parseList(
  value: unknown,
  allowed?: Set<string>,
): string[] | undefined {
  const raw = Array.isArray(value) ? value : [first(value)];
  const parsed = raw
    .filter((entry): entry is string => typeof entry === "string")
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= MAX_VALUE_LENGTH)
    .filter((entry) => !allowed || allowed.has(entry));

  // Capped so a hand-written URL cannot turn one request into a huge ANY(...).
  const unique = [...new Set(parsed)].slice(0, MAX_LIST_VALUES);
  return unique.length > 0 ? unique : undefined;
}

function parseAudience(value: unknown): string | undefined {
  const raw = first(value);
  if (!raw) return undefined;
  const normalised = `${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}`;
  return AUDIENCES.has(normalised) ? normalised : undefined;
}

/** A cursor is meaningless without knowing which way to walk from it. */
function parseCursorDir(value: unknown): "next" | "prev" | undefined {
  const raw = first(value);
  return raw === "next" || raw === "prev" ? raw : undefined;
}

// This is the main function of the file — everything above it is a small
// helper this function uses. It receives the raw `req.query` object and
// returns a clean `SearchRequest` object (the type is defined in
// services/listingSearch.service.ts) that the rest of the search code relies
// on being correct.
export function parseSearchRequest(queryString: Request["query"]): SearchRequest {
  // `?.` (optional chaining) means "only call .trim() if the value before it
  // isn't undefined" — `first(...)` can return undefined when the query
  // param wasn't sent at all, and calling .trim() on undefined would crash.
  // The trailing `|| undefined` turns an empty string into undefined too, so
  // an empty search box means "no search," not "search for nothing."
  const q = first(queryString.q)?.trim().slice(0, MAX_QUERY_LENGTH) || undefined;

  const sortRaw = first(queryString.sort) as SortKey | undefined;
  // This is a ternary expression: `condition ? valueIfTrue : valueIfFalse`.
  // Ranking needs a query to rank against, so default to newest without one.
  const sort: SortKey =
    sortRaw && SORTS.has(sortRaw) ? sortRaw : q ? "relevance" : "newest";

  let minPrice = parseNumber(queryString.minPrice);
  let maxPrice = parseNumber(queryString.maxPrice);
  // A reversed range would match nothing at all; treat it as a typo and swap.
  // `[minPrice, maxPrice] = [maxPrice, minPrice]` is array destructuring used
  // to swap two variables in one line, without needing a temporary variable.
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  // The object returned here becomes the single source of truth for this
  // search request as it travels into searchListings() next.
  return {
    q,
    categorySlugs: parseList(queryString.category),
    subcategorySlug: first(queryString.subcategory) || undefined,
    audience: parseAudience(queryString.audience),
    cities: parseList(queryString.city),
    conditions: parseList(queryString.condition, CONDITIONS),
    sizes: parseList(queryString.size),
    colours: parseList(queryString.colour),
    priceBands: parseList(queryString.priceBand, PRICE_BAND_IDS),
    minPrice,
    maxPrice,
    postedWithinDays: parseNumber(queryString.postedWithin),
    sort,
    page: parsePositiveInt(queryString.page, 1),
    perPage: parsePositiveInt(queryString.perPage, 24),
    cursor: first(queryString.cursor),
    cursorDir: parseCursorDir(queryString.cursorDir),
    // Echoed back from page 1's own response — see the comment on
    // `SearchRequest.fuzzy` for why this needs to survive to later pages.
    fuzzy: first(queryString.fuzzy) === "1" || first(queryString.fuzzy) === "true",
  };
}
