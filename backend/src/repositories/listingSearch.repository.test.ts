/**
 * Integration tests against the real database — see `../test/fixtures.ts`
 * for how a shared, 100k-row production dataset stays safe to test against.
 *
 * Every query here is scoped with `q: "<marker>"`, a title fragment unique to
 * that test's fixture rows. Full-text search on the marker isolates exactly
 * those rows out of the other 100k+, so expected counts and orderings can be
 * hand-computed instead of guessed at.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTestDatabase,
  disconnectTestDatabase,
  pickCategorySlugs,
  seedFixtureUser,
  seedListings,
  wipeFixtures,
} from "../test/fixtures";
import {
  countSearchMatches,
  fetchFacetCounts,
  searchListingsExact,
  type SearchRow,
} from "./listingSearch.repository";

let sellerId: number;
let categories: string[];

beforeAll(async () => {
  await connectTestDatabase();
  // Heals any debris a previous crashed run left behind before adding more.
  await wipeFixtures();
  sellerId = await seedFixtureUser();
  categories = await pickCategorySlugs(2);
});

afterAll(async () => {
  await wipeFixtures();
  await disconnectTestDatabase();
});

describe("facet counts against a fixture with hand-known answers", () => {
  const MARKER = "ZZZVITESTFACET";
  const catA = () => categories[0];
  const catB = () => categories[1];

  beforeAll(async () => {
    const [a, b] = categories;
    await seedListings(sellerId, [
      { title: `${MARKER} one`, categorySlug: a, condition: "Good", city: "FacetCityA" },
      { title: `${MARKER} two`, categorySlug: a, condition: "Good", city: "FacetCityA" },
      { title: `${MARKER} three`, categorySlug: a, condition: "Good", city: "FacetCityA" },
      { title: `${MARKER} four`, categorySlug: a, condition: "Good", city: "FacetCityA" },
      { title: `${MARKER} five`, categorySlug: a, condition: "Fair", city: "FacetCityB" },
      { title: `${MARKER} six`, categorySlug: a, condition: "Fair", city: "FacetCityB" },
      { title: `${MARKER} seven`, categorySlug: a, condition: "Fair", city: "FacetCityB" },
      { title: `${MARKER} eight`, categorySlug: b, condition: "Good", city: "FacetCityA" },
      { title: `${MARKER} nine`, categorySlug: b, condition: "Good", city: "FacetCityA" },
      { title: `${MARKER} ten`, categorySlug: b, condition: "Good", city: "FacetCityA" },
      { title: `${MARKER} eleven`, categorySlug: b, condition: "Good", city: "FacetCityA" },
      { title: `${MARKER} twelve`, categorySlug: b, condition: "Good", city: "FacetCityA" },
    ]);
  });

  it("counts every group correctly with no filter applied", async () => {
    const rows = await fetchFacetCounts({ q: MARKER, fuzzy: false });

    const city = rows.filter((row) => row.facet === "city");
    expect(city.find((r) => r.value === "FacetCityA")?.total).toBe("9"); // 4 (A/Good) + 5 (B/Good)
    expect(city.find((r) => r.value === "FacetCityB")?.total).toBe("3"); // 3 (A/Fair)

    const category = rows.filter((row) => row.facet === "category");
    expect(category.find((r) => r.value === catA())?.total).toBe("7"); // 4 + 3
    expect(category.find((r) => r.value === catB())?.total).toBe("5");
  });

  it("re-narrows every other facet once one is picked, without zeroing its own list", async () => {
    // Filtering to category A must leave category's own list showing both
    // options (so switching is still possible) while condition and city —
    // neither of which is the filter just applied — narrow to A's rows only.
    const rows = await fetchFacetCounts({
      q: MARKER,
      categorySlugs: [categories[0]],
      fuzzy: false,
    });

    const category = rows.filter((row) => row.facet === "category");
    expect(category.find((r) => r.value === catA())?.total).toBe("7");
    expect(category.find((r) => r.value === catB())?.total).toBe("5");

    const condition = rows.filter((row) => row.facet === "condition");
    expect(condition.find((r) => r.value === "Good")?.total).toBe("4");
    expect(condition.find((r) => r.value === "Fair")?.total).toBe("3");

    const city = rows.filter((row) => row.facet === "city");
    expect(city.find((r) => r.value === "FacetCityA")?.total).toBe("4");
    expect(city.find((r) => r.value === "FacetCityB")?.total).toBe("3");
  });

  it("selecting more than one city (OR within the filter) widens the other facets' counts to match — not the same as a single city", async () => {
    // Both cities selected together is the same set of rows as no city filter
    // at all (9 + 3 = all 12) — proving the two selected values are OR'd
    // together, not narrowed further as if only the last one applied.
    const bothCities = await fetchFacetCounts({
      q: MARKER,
      cities: ["FacetCityA", "FacetCityB"],
      fuzzy: false,
    });
    const condition = bothCities.filter((row) => row.facet === "condition");
    expect(condition.find((r) => r.value === "Good")?.total).toBe("9"); // 4 + 5
    expect(condition.find((r) => r.value === "Fair")?.total).toBe("3");

    // City is its own facet, so its own list is unaffected by which cities
    // are selected — same invariant category already relies on.
    const city = bothCities.filter((row) => row.facet === "city");
    expect(city.find((r) => r.value === "FacetCityA")?.total).toBe("9");
    expect(city.find((r) => r.value === "FacetCityB")?.total).toBe("3");

    // A single city, for contrast: condition narrows to just that city's rows.
    const oneCity = await fetchFacetCounts({
      q: MARKER,
      cities: ["FacetCityB"],
      fuzzy: false,
    });
    const conditionOneCity = oneCity.filter((row) => row.facet === "condition");
    expect(conditionOneCity.find((r) => r.value === "Fair")?.total).toBe("3");
    expect(conditionOneCity.find((r) => r.value === "Good")?.total).toBeUndefined();
  });
});

describe("combined filters, including a search term", () => {
  const MARKER = "ZZZVITESTCOMBO";

  beforeAll(async () => {
    const [a, b] = categories;
    await seedListings(sellerId, [
      // Matches every filter below: the marker word, category A, ComboCityX,
      // and a price inside the requested range.
      { title: `${MARKER} match`, categorySlug: a, city: "ComboCityX", price: 2000 },
      // Right marker and price, wrong category — must be excluded.
      { title: `${MARKER} wrong category`, categorySlug: b, city: "ComboCityX", price: 2000 },
      // Right marker and price, wrong city — must be excluded.
      { title: `${MARKER} wrong city`, categorySlug: a, city: "ComboCityY", price: 2000 },
      // Right marker, category and city, price outside the range — must be excluded.
      { title: `${MARKER} wrong price`, categorySlug: a, city: "ComboCityX", price: 99000 },
    ]);
  });

  it("returns only the row satisfying every filter at once (search term + category + city + price range)", async () => {
    const rows = await searchListingsExact({
      q: MARKER,
      categorySlugs: [categories[0]],
      cities: ["ComboCityX"],
      minPrice: 500,
      maxPrice: 5000,
      sort: "relevance",
      limit: 10,
      offset: 0,
    });

    // Not "the top result happens to be the right one" — the other three rows
    // must be absent entirely, each failing exactly one of the four filters.
    expect(rows.length).toBe(1);
    expect(rows[0].title).toContain("match");
  });

  it("selecting more than one category returns rows from any of them, not just the first", async () => {
    const rows = await searchListingsExact({
      q: MARKER,
      categorySlugs: categories,
      sort: "relevance",
      limit: 10,
      offset: 0,
    });

    // Every fixture row above is category A or B, so all four come back once
    // the category filter stops narrowing to a single one.
    expect(rows.length).toBe(4);
  });

  it("selecting more than one city returns rows from any of them, not just the first — same OR-within-a-filter rule as category", async () => {
    const rows = await searchListingsExact({
      q: MARKER,
      cities: ["ComboCityX", "ComboCityY"],
      sort: "relevance",
      limit: 10,
      offset: 0,
    });

    // Every fixture row above is ComboCityX or ComboCityY, so all four come
    // back once the city filter stops narrowing to a single one.
    expect(rows.length).toBe(4);
  });

  it("still ANDs across different filter groups even when each one is itself multi-select", async () => {
    // categorySlugs is multi-select (both categories — an OR that, on its
    // own, would admit all 4 rows, including "wrong category"), but it is
    // still ANDed against city and price: only rows that ALSO match
    // ComboCityX AND the price range survive.
    const rows = await searchListingsExact({
      q: MARKER,
      categorySlugs: categories,
      cities: ["ComboCityX"],
      minPrice: 500,
      maxPrice: 5000,
      sort: "relevance",
      limit: 10,
      offset: 0,
    });

    // "match" (category A) and "wrong category" (category B) both satisfy
    // city + price now that category no longer excludes B — proving the
    // category OR is real — while "wrong city" and "wrong price" are still
    // correctly excluded by their respective filters regardless.
    const titles = rows.map((row) => row.title).sort();
    expect(titles).toEqual([
      `ZZZVITEST ${MARKER} match`,
      `ZZZVITEST ${MARKER} wrong category`,
    ]);
  });
});

describe("relevance filtering", () => {
  const MARKER = "ZZZVITESTRANK";

  beforeAll(async () => {
    await seedListings(sellerId, [
      {
        // "camera" only in the description.
        title: `${MARKER} Leather Wallet Organizer`,
        description: "A slim wallet that also fits a camera memory card.",
        categorySlug: categories[0],
      },
      {
        // "camera" in the title itself.
        title: `${MARKER} Vintage Camera Bag`,
        description: "Padded bag for carrying photography equipment.",
        categorySlug: categories[0],
      },
    ]);
  });

  /**
   * A description-only match for "camera" used to still appear (ranked
   * below the title match, never dropped) — reasonable for two rows, but
   * at 100,000+ rows the same handful of description phrases recur across
   * hundreds of otherwise-unrelated listings each, and a description-only
   * hit is no longer one extra, lower-priority result: it's thousands of
   * them, indistinguishable from noise once anything but "relevance" is the
   * sort (see `exactRelevanceClause`). This fixture keeps that same 2-row
   * shape, but now expects the weaker match excluded outright, not merely
   * ranked second.
   */
  it("excludes a description-only match for the same word once a title match exists", async () => {
    const rows = await searchListingsExact({
      q: `${MARKER} camera`,
      sort: "relevance",
      limit: 10,
      offset: 0,
    });

    expect(rows.length).toBe(1);
    expect(rows[0].title).toContain("Vintage Camera Bag");
  });

  /**
   * The floor side of the same clause: when nothing better exists for this
   * query, a description-only match must still surface rather than being
   * excluded against a ceiling of its own making — a query that only ever
   * matches via description doesn't retroactively become "irrelevant" for
   * having no title match to be worse than.
   */
  it("still returns a description-only match when it is the only kind of match for this query", async () => {
    // "memory" appears only in Leather Wallet Organizer's description
    // ("camera memory card") — neither fixture row has it in the title, so
    // this is the only candidate the marker-scoped query has at all, not one
    // ranked below a better match that happens to exist alongside it.
    const rows = await searchListingsExact({
      q: `${MARKER} memory`,
      sort: "relevance",
      limit: 10,
      offset: 0,
    });

    expect(rows.length).toBe(1);
    expect(rows[0].title).toContain("Leather Wallet Organizer");
  });
});

describe("pagination stability", () => {
  const MARKER = "ZZZVITESTPAGE";
  const PAGE_SIZE = 4;
  const TOTAL = 10;
  let seededIds: string[];

  beforeAll(async () => {
    // One second apart and strictly decreasing, so "newest first" is a total,
    // known order: item 0 is newest, item 9 is oldest.
    const now = Date.now();
    seededIds = await seedListings(
      sellerId,
      Array.from({ length: TOTAL }, (_, index) => ({
        title: `${MARKER} item ${index}`,
        categorySlug: categories[0],
        postedAt: new Date(now - index * 1000),
      })),
    );
  });

  it("walks every row exactly once via cursor, forward then reflected back", async () => {
    const seen: string[] = [];
    let cursor: { rank?: number; postedAt?: string; id: string } | undefined;

    while (seen.length < TOTAL) {
      const rows = await searchListingsExact({
        q: MARKER,
        sort: "newest",
        limit: PAGE_SIZE,
        offset: 0,
        seek: cursor ? { cursor, direction: "next" } : null,
      });
      if (rows.length === 0) break;

      seen.push(...rows.map((row) => row.id));
      const last = rows[rows.length - 1];
      cursor = { postedAt: last.posted_at.toISOString(), id: last.id };
    }

    // Every row exactly once: no id skipped, none repeated across page
    // boundaries — the property a keyset cursor is supposed to guarantee.
    expect(seen.length).toBe(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
  });

  it("does not shift already-seen rows when a new one is posted mid-walk", async () => {
    // Page 1 of the walk, before anything new arrives.
    const page1 = await searchListingsExact({
      q: MARKER,
      sort: "newest",
      limit: PAGE_SIZE,
      offset: 0,
    });
    const page1Ids = page1.map((row) => row.id);

    // Someone posts a brand-new listing while that page is on screen —
    // newer than everything already fetched.
    const [newId] = await seedListings(sellerId, [
      { title: `${MARKER} item brand-new`, categorySlug: categories[0] },
    ]);

    const last = page1[page1.length - 1];
    const page2 = await searchListingsExact({
      q: MARKER,
      sort: "newest",
      limit: PAGE_SIZE,
      offset: 0,
      seek: {
        cursor: { postedAt: last.posted_at.toISOString(), id: last.id },
        direction: "next",
      },
    });
    const page2Ids = page2.map((row) => row.id);

    // Page 2 contains none of what page 1 already showed, and the new row —
    // newer than the cursor it resumed from — correctly does not
    // retroactively appear in it either.
    expect(page2Ids.some((id) => page1Ids.includes(id))).toBe(false);
    expect(page2Ids).not.toContain(newId);

    // The other half of "stable": not just no duplicates, but no gap either.
    // Page 2 must be *exactly* items 4-7 from the original seed order — the
    // four rows immediately after page 1's — in that order. If the new
    // insert had shifted anything, one of these would be missing or a page 1
    // row would reappear here instead.
    expect(page2Ids).toEqual(seededIds.slice(4, 8));
  });
});

describe("relevance cursor pagination across a tied-rank cluster", () => {
  const MARKER = "ZZZVITESTRANKTIE";
  const TOTAL = 10;
  const PAGE_SIZE = 4;
  let seededIds: string[];

  beforeAll(async () => {
    // Every row's title is the identical marker text, so ts_rank ties
    // exactly across all of them for this query -- the same kind of large
    // tied-rank cluster a real one-word query produces (see
    // RANK_EXPRESSION's own comment), which is where a `prev` keyset seek
    // used to strand on a float-precision boundary and come back empty
    // despite a correct, nonzero total.
    seededIds = await seedListings(
      sellerId,
      Array.from({ length: TOTAL }, (_, index) => ({
        title: MARKER,
        categorySlug: categories[0],
        postedAt: new Date(Date.now() - index * 1000),
      })),
    );
  });

  it("walks forward through the tied cluster, then all the way back, with no empty page", async () => {
    const seenForward: string[] = [];
    let cursor: { rank?: number; postedAt?: string; id: string } | undefined;
    let lastRows: SearchRow[] = [];

    while (seenForward.length < TOTAL) {
      const rows: SearchRow[] = await searchListingsExact({
        q: MARKER,
        sort: "relevance",
        limit: PAGE_SIZE,
        offset: 0,
        seek: cursor ? { cursor, direction: "next" } : null,
      });
      // The bug this guards against: an empty page here despite rows still
      // left to walk, exactly the failure a `prev` seek hit in production.
      expect(rows.length).toBeGreaterThan(0);
      lastRows = rows;
      seenForward.push(...rows.map((row) => row.id));
      const last = rows[rows.length - 1];
      cursor = {
        rank: Number(last.rank),
        postedAt: last.posted_at.toISOString(),
        id: last.id,
      };
    }
    expect(seenForward.length).toBe(TOTAL);
    expect(new Set(seenForward).size).toBe(TOTAL);

    // Now walk all the way back from wherever the forward walk ended, via
    // `prev` — the exact direction/sort combination that was stranding on
    // the tied boundary. Seeded with the last forward page's own rows: a
    // `prev` seek is exclusive of the row it resumes from, so those rows
    // are never handed back by the backward walk itself.
    const seenBack: string[] = [...lastRows.map((row) => row.id)];
    let first = lastRows[0];
    let backCursor = {
      rank: Number(first.rank),
      postedAt: first.posted_at.toISOString(),
      id: first.id,
    };
    while (seenBack.length < TOTAL) {
      const rows: SearchRow[] = await searchListingsExact({
        q: MARKER,
        sort: "relevance",
        limit: PAGE_SIZE,
        offset: 0,
        seek: { cursor: backCursor, direction: "prev" },
      });
      if (rows.length === 0) break;
      seenBack.push(...rows.map((row) => row.id));
      first = rows[0];
      backCursor = {
        rank: Number(first.rank),
        postedAt: first.posted_at.toISOString(),
        id: first.id,
      };
    }
    expect(seenBack.length).toBe(TOTAL);
    expect(new Set(seenBack).size).toBe(TOTAL);
    expect(new Set(seededIds).size).toBe(TOTAL);
  });
});

describe("SQL injection safety", () => {
  it("treats a destructive-looking query as a literal string, not executable SQL", async () => {
    const malicious = "'; DROP TABLE listings; --";

    await expect(
      searchListingsExact({ q: malicious, sort: "relevance", limit: 10, offset: 0 }),
    ).resolves.toBeDefined();

    // The table is still there with its usual scale of data — nothing was
    // dropped or truncated by a string that was never sent as SQL, only ever
    // as a bound parameter.
    const total = await countSearchMatches({});
    expect(total).toBeGreaterThan(1000);
  });

  it("does not let a tautology-shaped query ('... OR 1=1 ...') widen the search to match everything", async () => {
    // The classic "always true" injection. If this text ever reached the
    // database as SQL rather than as a bound value, the WHERE clause would
    // become tautological and match every row instead of none.
    const rows = await searchListingsExact({
      q: "' OR 1=1 --",
      sort: "relevance",
      limit: 24,
      offset: 0,
    });
    const totalUnfiltered = await countSearchMatches({});

    expect(rows.length).toBeLessThan(100);
    expect(rows.length).toBeLessThan(totalUnfiltered);
  });
});
