import { useEffect, useMemo, useRef, useState } from "react";
import Container from "../../components/layout/Container";
import { useSearchParams } from "react-router-dom";
import { FiBookmark, FiSliders, FiX } from "react-icons/fi";
import Breadcrumbs from "../../components/common/Breadcrumbs";
import CategoryStrip from "../../components/categories/CategoryStrip";
import SavedSearchesMenu from "../../components/search/SavedSearchesMenu";
import EmptyState from "../../components/common/EmptyState";
import ListingGridSkeleton from "../../components/common/ListingGridSkeleton";
import LoadingOverlay from "../../components/common/LoadingOverlay";
import FilterDrawer from "../../components/filters/FilterDrawer";
import FilterSidebar from "../../components/filters/FilterSidebar";
import ListingGrid from "../../components/listings/ListingGrid";
import Button from "../../components/common/Button";
import Pagination from "../../components/search/Pagination";
import SortDropdown from "../../components/search/SortDropdown";
import {
  describeFilters,
  humanizeSubcategorySlug,
  paramsFromSearch,
  searchToParams,
  type SearchParams,
} from "../../lib/search";
import { searchListingsViaApi } from "../../lib/searchApi";
import { fetchCategories } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { useLoadingState } from "../../hooks/useLoadingState";
import { usePageGate } from "../../store/RouteGate";
import { useAuth } from "../../store/AuthContext";
import { useSavedSearches } from "../../store/SavedSearchesContext";

/**
 * The search results page — the core of the marketplace.
 *
 * The URL is the only place the current search is stored. Every control writes
 * to it and the page reads back out of it, which is what makes a result page
 * bookmarkable, shareable, reload-safe and correct under the back button. Held
 * in component state instead, all four of those would quietly break.
 *
 * The full round trip, end to end, on every filter click, sort change, or
 * page turn:
 *   1. User clicks a filter checkbox / sort option / page number.
 *   2. `update(...)` below merges that change into `params` and writes the
 *      new query string into the URL (`setSearch`).
 *   3. React Router re-renders this component with the new URL; `search`
 *      (the URLSearchParams) changes, so `params` (`paramsFromSearch`) and
 *      `key` (the query string) are recomputed.
 *   4. `useApi` sees `key` changed and calls `searchListingsViaApi(params)`.
 *   5. `searchListingsViaApi` (lib/searchApi.ts) reshapes `params` into the
 *      querystring the backend expects and calls `searchListings` (lib/api.ts).
 *   6. `searchListings` does `fetch('/api/search/listings?...')` — an actual
 *      HTTP request leaves the browser here.
 *   7. The Express route -> controller -> service -> repository chain on the
 *      backend runs the real SQL against Postgres (full-text search, filters,
 *      facet counts, sorting, pagination all happen there — see
 *      backend/src/services/listingSearch.service.ts) and sends back JSON.
 *   8. `searchListings` unwraps the JSON envelope; `searchListingsViaApi`
 *      reshapes the result into this page's `SearchResult` type.
 *   9. `useApi` stores it as `data`; this component re-renders with the new
 *      `results`, and React updates the DOM to show the new listings.
 */
function SearchResults() {
  const [search, setSearch] = useSearchParams();
  const { user } = useAuth();
  const { save } = useSavedSearches();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  /* True only for the round trip `save()` itself makes (checking the current
     total, then creating the row) — not the login-prompt path inside it,
     which resolves immediately and needs no loading state of its own. */
  const [savingSearch, setSavingSearch] = useState(false);
  /* A second, ref-backed lock alongside `savingSearch` — same reasoning as
     PostAd's own `submittingRef`: a ref updates instantly, with no render in
     between, where `savingSearch` (state) only takes effect on the next
     render. Two clicks close enough together could otherwise both read the
     same stale `savingSearch = false` and both slip past the guard below,
     firing two save requests (confirmed live: three rapid clicks created
     three saved-search rows before this ref was added). */
  const savingSearchRef = useRef(false);
  /* Set once, right after a response arrives with `categoryFallback` — the
     redirect below immediately drops `q` from the URL, so this is the only
     record left that the category now showing came from a dead-end query
     rather than being picked directly. Cleared whenever the query changes
     again (see `update`). */
  const [fallbackNotice, setFallbackNotice] = useState<{
    query: string;
    label: string;
  } | null>(null);

  const params = useMemo(() => paramsFromSearch(search), [search]);

  /* Matching, faceting, sorting and paging are the server's job now. The URL
     remains the only place the search is stored, so its query string is what
     the request is rebuilt from whenever it changes. */
  const key = search.toString();
  const { data, loading } = useApi(() => searchListingsViaApi(params), [key]);

  /* Two distinct loading shapes. The very first search has nothing to show, so
     it renders a skeleton grid. Every search after that (a new filter, sort or
     page) already has results on screen, so those stay and are dimmed under an
     "updating" overlay rather than being thrown away and rebuilt — which is
     what made each filter click feel like a full reload. The overlay is gated
     on a short delay so an instant refetch never flashes it. */
  const { showSkeleton, showOverlay } = useLoadingState(loading, Boolean(data));

  /* Arriving from a category tile or the search box is a fresh page with nothing
     to show, so the branded loader covers the viewport until the first results
     are in. Gated on showSkeleton rather than `loading`: a filter, sort or page
     change already has results on screen and keeps the dimmed overlay below,
     which a full-screen takeover on every click would replace. */
  usePageGate(showSkeleton);

  /* Two things the server can settle that the URL needs to catch up to:
     - A page past the last real one (e.g. a bookmarked or hand-edited URL)
       comes back pointing at the last real page instead.
     - The first page of a query that only matches via typo-tolerant search
       comes back flagged `fuzzy`, which every later page of the *same*
       search needs echoed back to it — see `SearchParams.fuzzy` — or page 2
       silently re-decides from scratch, finds the same exact-text miss page
       1 did, and comes back empty.
     Either way the URL is corrected to match so it stays the single source of
     truth — a reload or a shared link lands on the same thing actually shown,
     rather than what was originally asked for. */
  useEffect(() => {
    if (!data) return;

    // A query that named no listing text but a real category ("mobile" ->
    // Mobiles) comes back as that category's own listings plus this flag.
    // The redirect drops `q` and selects the category instead, so every page
    // after this one is an ordinary category browse — no fallback-specific
    // handling needed anywhere else, including in this same effect's other
    // branch below.
    if (data.categoryFallback) {
      setFallbackNotice({
        query: params.q,
        label: data.categoryFallback.subcategoryLabel ?? data.categoryFallback.categoryLabel,
      });
      setSearch(
        searchToParams({
          ...params,
          q: "",
          categories: [data.categoryFallback.categorySlug],
          subcategory: data.categoryFallback.subcategorySlug,
          page: 1,
          cursor: null,
          cursorDir: null,
          fuzzy: false,
        }),
        { replace: true },
      );
      return;
    }

    if (data.page !== params.page || data.fuzzy !== params.fuzzy) {
      setSearch(
        searchToParams({ ...params, page: data.page, fuzzy: data.fuzzy }),
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const { data: categories } = useApi(() => fetchCategories(), []);

  /* An empty result while the first request is in flight, so every reader below
     can stay written against a plain object rather than a nullable one. The
     grid shows skeletons off `loading`, not off an empty list. */
  const results = data ?? {
    items: [],
    total: 0,
    page: params.page,
    perPage: 12,
    pageCount: 1,
    suggestion: null,
    nextCursor: null,
    prevCursor: null,
    fuzzy: params.fuzzy,
    categoryFallback: null,
    facets: { category: [], city: [], condition: [], price: [] },
  };

  const chips = describeFilters(params);

  /**
   * Home / <Category> / "<query>" — whichever parts of that apply.
   *
   * Only shown for exactly one selected category: with several selected at
   * once there is no single category this search is "inside", and the
   * filter chips below already list every one of them.
   */
  const singleCategory = params.categories.length === 1 ? params.categories[0] : null;
  const categoryLabel = singleCategory
    ? ((categories ?? []).find((entry) => entry.slug === singleCategory)
        ?.label ?? singleCategory)
    : null;

  const trail = [
    { label: "Home", to: "/home" },
    ...(categoryLabel
      ? [{ label: categoryLabel, to: `/search?category=${singleCategory}` }]
      : []),
    ...(categoryLabel && params.subcategory
      ? [{ label: humanizeSubcategorySlug(params.subcategory) }]
      : []),
    ...(params.q ? [{ label: `"${params.q}"` }] : []),
    ...(!categoryLabel && !params.q ? [{ label: "All listings" }] : []),
  ];

  /**
   * Applies a change to the search.
   *
   * Any change other than paging resets to page one: after narrowing the
   * results, page 7 of the old search may not exist, and landing on an empty
   * page reads as "no results" when there are plenty.
   */
  const update = (patch: Partial<SearchParams>) => {
    const next: SearchParams = { ...params, ...patch };
    const changingPage = "page" in patch;
    if (!changingPage) {
      next.page = 1;
      // A cursor is only valid against the search it came from; carrying one
      // into a new filter or sort would seek through the wrong result set.
      next.cursor = null;
      next.cursorDir = null;
    }
    // `fuzzy` is only valid for the query text it was determined for. Changing
    // the text itself must re-decide fresh on the next response — but a filter
    // or sort change, which keeps the same text, must not silently reset it:
    // that would drop a fuzzy-only search back to an exact-only one that finds
    // nothing, the moment anything other than the page number changes.
    if ("q" in patch) {
      next.fuzzy = false;
      setFallbackNotice(null);
    }

    /*
     * Filters and sort replace the current history entry; only paging pushes a
     * new one.
     *
     * Pushing on every filter change buried the rest of history: ticking six
     * boxes meant six presses of Back to get off the results page, each one
     * silently undoing a single checkbox. Replacing keeps Back meaning "leave
     * this search", which is what people expect, while the URL still holds the
     * complete state so a result page is bookmarkable and reload-safe (§4C).
     *
     * Paging is the exception — Back returning to the previous page of results
     * is genuinely useful, and it is one entry per page rather than per click.
     */
    setSearch(searchToParams(next), { replace: !changingPage });
    setSavedNotice(false);
  };

  /** Removes one filter, leaving the rest untouched. */
  const clearChip = (key: string) => {
    if (key.startsWith("condition:")) {
      const value = key.slice("condition:".length);
      update({ conditions: params.conditions.filter((entry) => entry !== value) });
      return;
    }
    if (key.startsWith("city:")) {
      const value = key.slice("city:".length);
      update({ cities: params.cities.filter((entry) => entry !== value) });
      return;
    }
    if (key.startsWith("price:")) {
      const value = key.slice("price:".length);
      update({ priceBands: params.priceBands.filter((entry) => entry !== value) });
      return;
    }
    if (key === "price") {
      update({ priceBands: [], minPrice: null, maxPrice: null });
      return;
    }
    if (key.startsWith("category:")) {
      const value = key.slice("category:".length);
      // A subcategory only means anything alongside exactly one category, so
      // removing any category chip takes it with it — same rule as toggling
      // one off in the sidebar.
      update({
        categories: params.categories.filter((entry) => entry !== value),
        subcategory: null,
      });
      return;
    }
    update({ [key]: null } as Partial<SearchParams>);
  };

  /* Resets the whole search — the query and every filter — back to all
     listings. The search term counts as something the visitor set, so clearing
     "everything" includes it; removing one thing is what the individual chips
     are for. */
  const clearAll = () =>
    update({
      q: "",
      categories: [],
      subcategory: null,
      cities: [],
      conditions: [],
      priceBands: [],
      minPrice: null,
      maxPrice: null,
      postedWithinDays: null,
    });

  const handleSaveSearch = async () => {
    // Checked and set together, synchronously, before anything `await`s —
    // see the comment on `savingSearchRef` above for why this (not
    // `savingSearch` state alone) is what actually closes the double-click
    // race.
    if (savingSearchRef.current) return;
    savingSearchRef.current = true;

    const name =
      [params.q || "All listings", params.cities.join(", ")].filter(Boolean).join(" in ") ||
      "All listings";
    setSavingSearch(true);
    try {
      // `save` itself opens the login prompt when signed out (and returns
      // false without saving anything) — so this button stays clickable
      // either way, same as the Like heart elsewhere, rather than being
      // disabled and silently unable to ever reach that prompt.
      const saved = await save(name, searchToParams(params).toString());
      if (saved) setSavedNotice(true);
    } finally {
      // In `finally`, not just after the `try` body: a failed save must
      // still release the button, or a network error would leave "Saving…"
      // on screen forever with no way to try again.
      setSavingSearch(false);
      savingSearchRef.current = false;
    }
  };

  return (
    <Container className="py-8">
      {/* No search box here: the header carries one on every page except the
         homepage, and two on a narrow screen was one too many. */}

      {/* Switch category without losing the rest of the search, with saved
          searches beside it. `min-w-0` lets the strip scroll inside the flex row
          rather than forcing the row wider than the page and pushing the menu
          off-screen. */}
      <div className="flex items-start gap-2 border-b border-taupe">
        <div className="min-w-0 flex-1">
          <CategoryStrip bare />
        </div>
        <SavedSearchesMenu />
      </div>

      <div className="mt-5">
        <Breadcrumbs trail={trail} />
      </div>

      <div className="mt-3">
        <h1 className="text-xl font-black tracking-tight text-charcoal-900 sm:text-2xl">
          {params.q ? `Results for "${params.q}"` : "All listings"}
        </h1>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-charcoal-500">
            {results.total.toLocaleString("en-IN")}{" "}
            {results.total === 1 ? "listing" : "listings"}
            {params.cities.length > 0 ? ` in ${params.cities.join(", ")}` : ""}
          </p>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden"
            >
              <FiSliders size={14} />
              Filters{chips.length > 0 && ` (${chips.length})`}
            </Button>

            <SortDropdown
              value={params.sort}
              onChange={(sort) => update({ sort })}
              hasQuery={Boolean(params.q)}
            />
          </div>
        </div>
      </div>

      {fallbackNotice && (
        <div className="mt-4 rounded-lg bg-cyan-50 px-4 py-2.5 text-sm text-cyan-800">
          No listings matched “{fallbackNotice.query}” — showing{" "}
          <span className="font-bold">{fallbackNotice.label}</span> instead.
        </div>
      )}

      {/* The active search term and every filter, each removable on its own,
          with one "Clear all" that resets the lot. Shows whenever there is a
          query or any filter — so a bare search like "sofa" can still be
          cleared here, not only once a filter is added. */}
      {(chips.length > 0 || params.q) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {params.q && (
            <button
              type="button"
              onClick={() => update({ q: "" })}
              className="flex items-center gap-1.5 rounded-full bg-mist px-3 py-1.5 text-xs font-semibold text-charcoal-900 transition hover:bg-mist-dark"
            >
              “{params.q}”
              <FiX size={12} />
            </button>
          )}

          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => clearChip(chip.key)}
              className="flex items-center gap-1.5 rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-100"
            >
              {chip.label}
              <FiX size={12} />
            </button>
          ))}

          <button
            type="button"
            onClick={clearAll}
            className="px-2 text-xs font-semibold text-charcoal-500 transition hover:text-charcoal-900"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[260px_1fr] lg:gap-10">
        <aside className="hidden lg:block">
          <FilterSidebar
            params={params}
            facets={results.facets}
            onChange={update}
            onClearAll={clearAll}
            activeCount={chips.length}
          />

          {/* Saving a search needs an account (§4A) */}
          <div className="mt-6 border-t border-taupe pt-5">
            {savedNotice ? (
              <p className="text-sm font-semibold text-emerald-700">
                Saved. See it under Saved searches.
              </p>
            ) : (
              <Button
                variant="outline"
                onClick={handleSaveSearch}
                disabled={savingSearch}
                fullWidth
              >
                <FiBookmark size={14} />
                {savingSearch ? "Saving…" : "Save this search"}
              </Button>
            )}
            {!user && (
              <p className="mt-2 text-xs text-charcoal-400">
                Log in to save searches and get a count of new matches.
              </p>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          {showSkeleton ? (
            <ListingGridSkeleton count={12} />
          ) : results.total === 0 ? (
            <EmptyState
              title="No listings found"
              description={
                results.suggestion
                  ? undefined
                  : "Try a different keyword, a wider price range, or another category."
              }
            >
              <div className="space-y-4">
                {results.suggestion && (
                  <p className="text-sm text-charcoal-500">
                    Did you mean{" "}
                    <button
                      type="button"
                      onClick={() => update({ q: results.suggestion ?? "" })}
                      className="font-bold text-cyan-600 underline decoration-cyan-300 underline-offset-2 transition hover:decoration-cyan-600"
                    >
                      {results.suggestion}
                    </button>
                    ?
                  </p>
                )}

                {chips.length > 0 && (
                  <div>
                    <p className="text-sm text-charcoal-500">Try removing a filter:</p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {chips.map((chip) => (
                        <button
                          key={chip.key}
                          type="button"
                          onClick={() => clearChip(chip.key)}
                          className="flex items-center gap-1.5 rounded-full border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 px-3 py-1.5 text-xs font-semibold text-charcoal-900 transition hover:border-charcoal-400 hover:text-charcoal-900"
                        >
                          {chip.label}
                          <FiX size={12} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </EmptyState>
          ) : (
            <LoadingOverlay active={showOverlay}>
              <ListingGrid listings={results.items} />
              <Pagination
                page={results.page}
                pageCount={results.pageCount}
                nextCursor={results.nextCursor}
                prevCursor={results.prevCursor}
                onChange={(page, cursor) => {
                  update({
                    page,
                    cursor: cursor?.value ?? null,
                    cursorDir: cursor?.dir ?? null,
                  });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </LoadingOverlay>
          )}
        </div>
      </div>

      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        params={params}
        facets={results.facets}
        onChange={update}
        onClearAll={clearAll}
        activeCount={chips.length}
        total={results.total}
      />
    </Container>
  );
}

export default SearchResults;
