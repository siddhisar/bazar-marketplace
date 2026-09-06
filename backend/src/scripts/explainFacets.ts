/**
 * Prints the facet-count SQL and its query plan, then times it.
 *
 * Exists so the performance claims in the README can be re-checked rather than
 * taken on trust: run it after any change to the facet query or its indexes.
 *
 *   npm run explain:facets
 *   npm run explain:facets -- shirt        (with a search term)
 */
import { buildFacetCountsQuery } from "../db/queries/listingFacets.sql";
import { config } from "../config/env";
import {
  connectDatabase,
  disconnectDatabase,
  query,
} from "../config/database";

/** A representative filtered search: a term, a colour, and a price ceiling. */
function scenarios(term?: string) {
  return [
    { name: "no filters", filters: {} },
    {
      name: "one facet selected (colour=Black)",
      filters: { colours: ["Black"] },
    },
    {
      name: "term + facet + price",
      filters: { q: term ?? "shirt", colours: ["Black"], maxPrice: 2000 },
    },
  ];
}

async function run() {
  const term = process.argv[2];
  await connectDatabase(config.databaseUrl);

  for (const { name, filters } of scenarios(term)) {
    const { text, values } = buildFacetCountsQuery(filters);

    console.log(`\n${"=".repeat(72)}`);
    console.log(`SCENARIO: ${name}`);
    console.log(`params:   ${JSON.stringify(values)}`);
    console.log("=".repeat(72));

    const { rows: plan } = await query<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS) ${text}`,
      values,
    );
    console.log(plan.map((row) => row["QUERY PLAN"]).join("\n"));

    // Three runs: the first can include plan time, the rest are warm.
    const timings: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now();
      await query(text, values);
      timings.push(performance.now() - started);
    }
    console.log(
      `\nwall clock: ${timings.map((ms) => `${ms.toFixed(1)}ms`).join(", ")}`,
    );
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("SQL for the last scenario:");
  console.log("=".repeat(72));
  console.log(buildFacetCountsQuery(scenarios(term)[2].filters).text);
}

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
