import { describe, expect, it } from "vitest";
import { buildListingWhere, type ListingFilters } from "./listingSearch.sql";

describe("buildListingWhere", () => {
  it("always requires status = 'active', with no other clause when no filter is set", () => {
    const where = buildListingWhere({});
    expect(where.text).toBe("l.status = 'active'");
    expect(where.values).toEqual([]);
  });

  it("combines several filters, one clause and one bound value each", () => {
    const filters: ListingFilters = {
      categorySlugs: ["mobiles"],
      cities: ["Pune"],
      conditions: ["Good", "Fair"],
      minPrice: 500,
      maxPrice: 5000,
    };

    const where = buildListingWhere(filters);

    expect(where.text).toContain("l.category_slug = ANY($1::text[])");
    expect(where.text).toContain("l.city = ANY($2::text[])");
    expect(where.text).toContain("l.condition = ANY($3::listing_condition[])");
    expect(where.text).toContain("l.price >= $4");
    expect(where.text).toContain("l.price <= $5");
    expect(where.values).toEqual([
      ["mobiles"],
      ["Pune"],
      ["Good", "Fair"],
      500,
      5000,
    ]);
  });

  it("accepts more than one city, bound as a single array parameter — same OR-within-a-filter rule as category", () => {
    const where = buildListingWhere({ cities: ["Pune", "Mumbai"] });

    expect(where.text).toBe("l.status = 'active'\n       AND l.city = ANY($1::text[])");
    expect(where.values).toEqual([["Pune", "Mumbai"]]);
  });

  it("accepts more than one price band, matched via the same bucketing the price facet counts with", () => {
    const where = buildListingWhere({ priceBands: ["0-5000", "50000-"] });

    expect(where.text).toContain("= ANY($1::text[])");
    expect(where.text).toContain("CASE");
    expect(where.values).toEqual([["0-5000", "50000-"]]);
  });

  it("accepts more than one category, bound as a single array parameter", () => {
    const where = buildListingWhere({ categorySlugs: ["mobiles", "cars"] });

    expect(where.text).toBe("l.status = 'active'\n       AND l.category_slug = ANY($1::text[])");
    expect(where.values).toEqual([["mobiles", "cars"]]);
  });

  it("drops exactly the clause for a filter that is cleared, leaving the rest untouched", () => {
    const withCity = buildListingWhere({ categorySlugs: ["mobiles"], cities: ["Pune"] });
    const cityCleared = buildListingWhere({ categorySlugs: ["mobiles"] });

    expect(withCity.text).toContain("l.city =");
    expect(cityCleared.text).not.toContain("l.city =");
    // The surviving filter's placeholder does not shift just because another
    // filter was removed — each filter's own presence decides its own $n.
    expect(cityCleared.text).toContain("l.category_slug = ANY($1::text[])");
    expect(cityCleared.values).toEqual([["mobiles"]]);
  });

  it("continues placeholder numbering from startIndex, for a caller that already bound $1", () => {
    const where = buildListingWhere({ categorySlugs: ["mobiles"] }, 1);
    expect(where.text).toBe("l.status = 'active'\n       AND l.category_slug = ANY($2::text[])");
  });

  it("treats an empty categorySlugs/conditions/sizes/colours array as no filter at all", () => {
    const where = buildListingWhere({
      categorySlugs: [],
      conditions: [],
      sizes: [],
      colours: [],
    });
    expect(where.text).toBe("l.status = 'active'");
    expect(where.values).toEqual([]);
  });
});
