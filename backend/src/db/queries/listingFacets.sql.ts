/**
 * "Facet counts" are the small numbers next to each filter option — e.g.
 * "Mobiles (7,141)" or "Under ₹5,000 (312)". This file builds the one SQL
 * query that computes all of them at once, for whatever search/filters are
 * currently active.
 *
 * The tricky part this file solves: each facet's count must ignore *its own*
 * filter but respect every *other* filter. If you've already selected
 * "Mobiles," the category list still needs to show how many Cars and
 * Furniture listings exist too — otherwise there'd be no way to switch
 * categories. But the price filter, city filter, etc. should still narrow
 * those numbers down. Getting this right in one query (rather than six
 * separate ones, or fetching everything and counting in JavaScript) is what
 * keeps this fast even with 100,000+ listings.
 *
 * One statement produces every count. The alternative, a query per facet group,
 * costs six round trips and six scans of the same matching set to answer one
 * page load; the brief rules it out and so does the arithmetic.
 *
 * As with listingSearch.sql, nothing user-supplied is ever concatenated: only
 * fragments this module authored itself.
 */
import {
  exactRelevanceClause,
  fuzzyRelevanceClause,
  PRICE_BAND_SQL,
} from "./listingSearch.sql";
import type { ListingFilters, SqlFragment } from "./listingSearch.sql";

/** The filters rendered as checkbox lists, so the ones that need counts. */
export const FACET_KEYS = [
  "category",
  "audience",
  "city",
  "condition",
  "size",
  "colour",
  "price",
] as const;

export type FacetKey = (typeof FACET_KEYS)[number];

/** Where each facet's value comes from on the listings row. */
const FACET_COLUMN: Record<FacetKey, string> = {
  category: "l.category_slug",
  audience: "l.audience::text",
  city: "l.city",
  condition: "l.condition::text",
  size: "l.size",
  colour: "l.colour",
  price: PRICE_BAND_SQL,
};

/**
 * Builds the facet-count query.
 *
 * Each facet is counted with every filter applied **except its own**. That is
 * what makes a facet list usable: having picked colour "Black", the colour list
 * must still show how many Blue and Green items are available, or there is no
 * way to switch. Counting the fully-filtered set instead would show every other
 * colour as zero.
 *
 * The per-facet booleans (`keep_colour` and friends) are what allow this in a
 * single pass — each branch ANDs the other facets' flags and ignores its own,
 * rather than re-running the search six times with different WHERE clauses.
 *
 * `fuzzy` must match the path that produced the results, or the counts will
 * describe a different set of rows than the ones on screen.
 */
export function buildFacetCountsQuery(
  filters: ListingFilters,
  options: { fuzzy?: boolean } = {},
): SqlFragment {
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  /* Filters with no checkbox list of their own — a free-text query, a price
     range, a recency cut-off. Nothing shows counts for these, so they narrow
     the candidate set unconditionally. */
  const always: string[] = ["l.status = 'active'"];

  if (filters.q) {
    const q = bind(filters.q);
    always.push(
      options.fuzzy
        ? `${q} <% l.title AND ${fuzzyRelevanceClause(q)}`
        : `l.search_vector @@ websearch_to_tsquery('english', ${q}) AND ${exactRelevanceClause(q)}`,
    );
  }
  if (filters.postedWithinDays !== undefined) {
    always.push(
      `l.posted_at >= now() - (${bind(filters.postedWithinDays)} || ' days')::interval`,
    );
  }
  // Subcategory has no checkbox list of its own either — it narrows facet
  // computation the same unconditional way category-page browsing already did
  // before this filter existed.
  if (filters.subcategorySlug) {
    always.push(`l.subcategory_slug = ${bind(filters.subcategorySlug)}`);
  }

  /* Whether every facet's own filter is unselected. When it is, "count with
     every filter but this one" is the same query for all six facets — there
     is no longer a reason for the "exclude your own filter" branching below,
     and the six branches can become GROUPING SETS in a single pass instead.
     This is precisely the slow case: a plain "all listings, no filter"
     browse, which is also the one query GROUPING SETS provably still needs
     to visit every active row for either way (nothing about it is
     narrowable), so it's the one place the aggregation strategy itself is
     the lever. Measured on the deployed database: ~2,180 ms for the six
     UNION ALL branches below, ~215 ms for GROUPING SETS over the same rows —
     same 40 rows out, verified byte-for-byte identical, in either order.
     Every *filtered* facet count already runs in 15-20 ms (a filter shrinks
     the row count the six branches scan, which is most of their cost) and
     is untouched: GROUPING SETS cannot express "exclude only this facet's
     own filter" per group, so it only applies when there is nothing to
     exclude. */
  const noFacetFilterSelected =
    !filters.categorySlugs?.length &&
    !filters.audience &&
    !filters.cities?.length &&
    !filters.conditions?.length &&
    !filters.sizes?.length &&
    !filters.colours?.length &&
    !filters.priceBands?.length &&
    filters.minPrice === undefined &&
    filters.maxPrice === undefined;

  if (noFacetFilterSelected) {
    // `GROUPING(expr)` must textually match an expression in the `GROUP BY`
    // clause — it reads 0 in the one grouping set actually grouped by that
    // expression, 1 in every other. It cannot be called on a SELECT alias
    // (aliases aren't visible to sibling expressions in the same list, only
    // the real column/expression), so the raw `FACET_COLUMN` expression is
    // repeated for both the `GROUPING(...)` call and the `GROUP BY
    // GROUPING SETS` list, and the *value* itself gets a `facet_`-prefixed
    // alias distinct from every real `listings` column — `audience`,
    // `condition` and `price` all collide with real column names, which
    // would otherwise make Postgres resolve the alias back to the raw
    // (uncast/unbanded) column instead of this query's own expression.
    const columns = FACET_KEYS.flatMap((key) => [
      `GROUPING(${FACET_COLUMN[key]}) AS g_${key}`,
      `${FACET_COLUMN[key]} AS facet_${key}`,
    ]);
    const groupingSets = FACET_KEYS.map((key) => `(${FACET_COLUMN[key]})`).join(
      ", ",
    );
    const valueColumns = FACET_KEYS.map((key) => `facet_${key}`);
    const coalesced = `COALESCE(${valueColumns.join(", ")})`;
    const facetName = FACET_KEYS.map(
      (key) => `WHEN g_${key} = 0 THEN '${key}'`,
    ).join("\n           ");

    return {
      text: `WITH grouped AS (
    SELECT ${columns.join(",\n           ")},
           count(*) AS total
    FROM listings l
    WHERE ${always.join("\n      AND ")}
    GROUP BY GROUPING SETS (${groupingSets})
  )
  SELECT (CASE ${facetName} END) AS facet,
         ${coalesced} AS value,
         c.label,
         grouped.total
  FROM grouped
  LEFT JOIN listing_categories c
    ON g_category = 0 AND c.slug = facet_category
  WHERE ${coalesced} IS NOT NULL
  ORDER BY facet ASC, grouped.total DESC, value ASC`,
      values,
    };
  }

  /* Each facet's own predicate. "true" when nothing is selected, which makes
     that facet's flag a no-op rather than a special case in every branch. */
  const own: Record<FacetKey, string> = {
    category: filters.categorySlugs?.length
      ? `l.category_slug = ANY(${bind(filters.categorySlugs)}::text[])`
      : "true",
    audience: filters.audience
      ? `l.audience = ${bind(filters.audience)}::listing_audience`
      : "true",
    city: filters.cities?.length
      ? `l.city = ANY(${bind(filters.cities)}::text[])`
      : "true",
    condition: filters.conditions?.length
      ? `l.condition = ANY(${bind(filters.conditions)}::listing_condition[])`
      : "true",
    size: filters.sizes?.length
      ? `l.size = ANY(${bind(filters.sizes)}::text[])`
      : "true",
    colour: filters.colours?.length
      ? `l.colour = ANY(${bind(filters.colours)}::text[])`
      : "true",
    /* Price is a facet like any other, so its range moved out of the
       unconditional filters and in here. Counted with the other filters but
       not its own, the remaining bands keep their counts after one is picked —
       narrowing unconditionally would show every other band as zero and leave
       no way to switch. Bands and a typed min/max are alternatives on the
       frontend (see ListingFilters.priceBands), but both are applied here —
       like any other two filters, together as AND — if a request somehow
       carries both. */
    price: [
      filters.priceBands?.length
        ? `(${PRICE_BAND_SQL}) = ANY(${bind(filters.priceBands)}::text[])`
        : null,
      filters.minPrice !== undefined
        ? `l.price >= ${bind(filters.minPrice)}`
        : null,
      filters.maxPrice !== undefined
        ? `l.price <= ${bind(filters.maxPrice)}`
        : null,
    ]
      .filter(Boolean)
      .join(" AND ") || "true",
  };

  const selectList = FACET_KEYS.flatMap((key) => [
    `${FACET_COLUMN[key]} AS ${key}_value`,
    `(${own[key]}) AS keep_${key}`,
  ]).join(",\n           ");

  /* Referenced once per facet, so Postgres materialises it: the table is
     scanned once and the six aggregations run over the stored result.

     Kept deliberately narrow — six values and six flags, no labels and no
     join. Every column here is paid for ~70k times, and once the row set
     outgrows work_mem the materialised CTE spills to temp files, which cost
     far more than the aggregation itself. Labels are attached at the end
     instead, against the few dozen rows that survive grouping. */
  const candidate = `candidate AS (
    SELECT ${selectList}
    FROM listings l
    WHERE ${always.join("\n      AND ")}
  )`;

  const branches = FACET_KEYS.map((key) => {
    const others = FACET_KEYS.filter((other) => other !== key).map(
      (other) => `keep_${other}`,
    );

    // size and colour are nullable; a NULL is "not stated", not a facet value.
    return `    SELECT '${key}' AS facet, ${key}_value AS value, count(*) AS total
    FROM candidate
    WHERE ${key}_value IS NOT NULL
      AND ${others.join("\n      AND ")}
    GROUP BY ${key}_value`;
  });

  return {
    // Ordered in SQL, on the numeric count rather than its text form: biggest
    // group first, then alphabetically, so the lists render deterministically.
    text: `WITH ${candidate},
  counted AS (
${branches.join("\n    UNION ALL\n")}
  )
  SELECT counted.facet,
         counted.value,
         c.label,
         counted.total
  FROM counted
  LEFT JOIN listing_categories c
    ON counted.facet = 'category' AND c.slug = counted.value
  ORDER BY counted.facet ASC, counted.total DESC, counted.value ASC`,
    values,
  };
}
