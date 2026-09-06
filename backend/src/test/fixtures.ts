/**
 * Test fixtures for the search suite.
 *
 * These tests run against the real, shared database rather than a mock —
 * facet counts, ranking and typo tolerance all depend on actual Postgres
 * behaviour (`tsvector`, `pg_trgm`, the query planner), which a mock cannot
 * stand in for honestly. To do that safely against a database that also
 * holds 100k+ real listings:
 *
 *  - Every fixture row is created under one dedicated user, found by a
 *    reserved email that nothing else will ever use.
 *  - Every fixture listing's title carries an unmistakable prefix.
 *  - `wipeFixtures` runs at the start *and* end of the suite. Running it
 *    first means a previous run that crashed before cleanup cannot leave
 *    permanent debris — the next run heals it before adding anything new.
 *
 * Deleting the user cascades to their listings (`seller_id ... ON DELETE
 * CASCADE`), so one statement is enough to remove everything this file adds.
 */
import { connectDatabase, disconnectDatabase, query } from "../config/database";
import { config } from "../config/env";

export const FIXTURE_EMAIL = "vitest-fixture@example.invalid";
export const FIXTURE_TITLE_PREFIX = "ZZZVITEST";

let connected = false;

export async function connectTestDatabase(): Promise<void> {
  if (connected) return;
  await connectDatabase(config.databaseUrl);
  connected = true;
}

export async function disconnectTestDatabase(): Promise<void> {
  if (!connected) return;
  await disconnectDatabase();
  connected = false;
}

/** Removes the fixture user and, by cascade, every listing it owns. */
export async function wipeFixtures(): Promise<void> {
  await query(`DELETE FROM users WHERE email = $1`, [FIXTURE_EMAIL]);
}

/** Creates (or reuses) the one user every fixture listing belongs to. */
export async function seedFixtureUser(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO users (email, display_name)
     VALUES ($1, 'Vitest Fixture')
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [FIXTURE_EMAIL],
  );
  return rows[0].id;
}

export type FixtureListing = {
  title: string;
  description?: string;
  categorySlug: string;
  audience?: "Men" | "Women" | "Unisex";
  condition?: "New with tags" | "Like new" | "Good" | "Fair";
  price?: number;
  /** Defaults to 1, same as the column default. */
  quantity?: number;
  city?: string;
  postedAt?: Date;
  status?: "active" | "sold" | "expired";
  /** Defaults to 30 days out; pass a past date to fixture an expired-but-unswept row. */
  expiresAt?: Date;
};

/** Inserts one listing per entry, title-prefixed, and returns their ids in order. */
export async function seedListings(
  sellerId: number,
  listings: FixtureListing[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const listing of listings) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO listings
         (seller_id, title, description, category_slug, audience, condition,
          price, quantity, city, status, posted_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id::text`,
      [
        sellerId,
        `${FIXTURE_TITLE_PREFIX} ${listing.title}`,
        listing.description ?? "A fixture row created for the automated test suite.",
        listing.categorySlug,
        listing.audience ?? "Unisex",
        listing.condition ?? "Good",
        listing.price ?? 1000,
        listing.quantity ?? 1,
        listing.city ?? "TestCity1",
        listing.status ?? "active",
        listing.postedAt ?? new Date(),
        listing.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

/** Two real, existing category slugs — fixtures use live categories rather than inventing one. */
export async function pickCategorySlugs(count = 2): Promise<string[]> {
  const { rows } = await query<{ slug: string }>(
    `SELECT slug FROM listing_categories ORDER BY slug LIMIT $1`,
    [count],
  );
  if (rows.length < count) {
    throw new Error(
      `Fixture setup needs ${count} category slugs to exist; found ${rows.length}. Run the marketplace seed first.`,
    );
  }
  return rows.map((row) => row.slug);
}
