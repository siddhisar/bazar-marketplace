/**
 * The URL is the only place a search's state lives (§4C) — a result page must
 * survive being turned into a query string and read back out of it exactly,
 * or a reload or a shared link silently loses part of what was being looked
 * for. These tests round-trip a `SearchParams` through `searchToParams` and
 * `paramsFromSearch` and check nothing was dropped or corrupted.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_PARAMS, paramsFromSearch, searchToParams, type SearchParams } from "./search";

describe("search params URL round trip", () => {
  it("recovers every field of a fully-populated search", () => {
    const original: SearchParams = {
      q: "denim jacket",
      categories: ["mens-fashion"],
      subcategory: "mens-fashion--mens-jackets",
      cities: ["Pune", "Mumbai"],
      conditions: ["Good", "Fair"],
      priceBands: [],
      minPrice: 500,
      maxPrice: 5000,
      postedWithinDays: 7,
      sort: "price_asc",
      page: 3,
      cursor: "eyJpZCI6IjEyMyJ9",
      cursorDir: "next",
      fuzzy: true,
    };

    const roundTripped = paramsFromSearch(searchToParams(original));

    expect(roundTripped).toEqual(original);
  });

  it("produces a clean URL for a plain search, with no default values written out", () => {
    const search = searchToParams(EMPTY_PARAMS);
    expect(search.toString()).toBe("");
  });

  it("round-trips a bare query with no filters, omitting the sort that matches its default", () => {
    const original: SearchParams = { ...EMPTY_PARAMS, q: "iphone", sort: "relevance" };
    const search = searchToParams(original);

    // "relevance" is the implied default once a query is present, so it is
    // not written out — a plain search stays a plain, shareable URL.
    expect(search.has("sort")).toBe(false);
    expect(paramsFromSearch(search)).toEqual(original);
  });

  it("keeps repeated condition values distinct through the round trip", () => {
    const search = searchToParams({ ...EMPTY_PARAMS, conditions: ["Good", "Fair"] });
    expect(search.getAll("condition")).toEqual(["Good", "Fair"]);

    const roundTripped = paramsFromSearch(search);
    expect(roundTripped.conditions).toEqual(["Good", "Fair"]);
  });

  it("keeps repeated category values distinct through the round trip, dropping a subcategory that no longer applies", () => {
    const search = searchToParams({
      ...EMPTY_PARAMS,
      categories: ["mobiles", "cars"],
      // Meaningless with two categories selected — must not survive the trip.
      subcategory: "mobiles--smartphones",
    });
    expect(search.getAll("category")).toEqual(["mobiles", "cars"]);
    expect(search.has("subcategory")).toBe(false);

    const roundTripped = paramsFromSearch(search);
    expect(roundTripped.categories).toEqual(["mobiles", "cars"]);
    expect(roundTripped.subcategory).toBeNull();
  });

  it("keeps repeated city values distinct through the round trip, same as category/condition", () => {
    const search = searchToParams({ ...EMPTY_PARAMS, cities: ["Pune", "Mumbai"] });
    expect(search.getAll("city")).toEqual(["Pune", "Mumbai"]);

    const roundTripped = paramsFromSearch(search);
    expect(roundTripped.cities).toEqual(["Pune", "Mumbai"]);
  });

  it("keeps repeated price band values distinct through the round trip, and drops one that isn't a real band id", () => {
    const search = searchToParams({ ...EMPTY_PARAMS, priceBands: ["0-5000", "50000-"] });
    expect(search.getAll("price")).toEqual(["0-5000", "50000-"]);

    const roundTripped = paramsFromSearch(search);
    expect(roundTripped.priceBands).toEqual(["0-5000", "50000-"]);

    // A hand-edited URL with a made-up band id must not silently pass through
    // to the API as a bind value the backend then has to reject on its own —
    // same defensive validation `conditions` already gets against REAL_CONDITIONS.
    const tampered = paramsFromSearch(new URLSearchParams("price=not-a-real-band"));
    expect(tampered.priceBands).toEqual([]);
  });

  it("leaves cursorDir null for a hand-edited URL that carries a cursor alone", () => {
    // `searchToParams` never emits one without the other, but a hand-edited
    // URL could — the API treats a cursor with no direction as absent
    // (see listingSearch.service.ts), so parsing it as null here is what
    // keeps that case inert rather than seeking blind.
    const params = paramsFromSearch(new URLSearchParams("cursor=abc123"));
    expect(params.cursor).toBe("abc123");
    expect(params.cursorDir).toBeNull();
  });
});
