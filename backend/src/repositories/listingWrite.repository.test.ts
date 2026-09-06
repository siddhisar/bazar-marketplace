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
  findListingsBySeller,
  markListingSold,
  sweepExpiredListings,
} from "./listingWrite.repository";
import { recordListingView } from "./listingViews.repository";
import { query } from "../config/database";

/** A second fixture account standing in for "someone who viewed the
 *  listing" — mirrors listingViews.repository.test.ts's own convention. */
const VIEWER_EMAIL = "vitest-viewer@example.invalid";

async function seedViewerUser(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO users (email, display_name)
     VALUES ($1, 'Vitest Viewer')
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [VIEWER_EMAIL],
  );
  return rows[0].id;
}

async function wipeViewerUser(): Promise<void> {
  await query(`DELETE FROM users WHERE email = $1`, [VIEWER_EMAIL]);
}

beforeAll(async () => {
  await connectTestDatabase();
  await wipeFixtures();
  await wipeViewerUser();
});

afterAll(async () => {
  await wipeFixtures();
  await wipeViewerUser();
  await disconnectTestDatabase();
});

describe("findListingsBySeller's viewer_count", () => {
  it("counts distinct viewers, not raw view_count, and never both a repeat visit twice", async () => {
    const sellerId = await seedFixtureUser();
    const viewerId = await seedViewerUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTVIEWERCOUNT", categorySlug },
    ]);

    // The raw counter climbs independently of who's viewing (mirrors the
    // seller opening their own listing, or an anonymous visit) — bumped by
    // hand here since incrementListingViewCount lives in
    // marketplace.repository.ts, not this file.
    await query(
      `UPDATE listings SET view_count = 5 WHERE id = $1::bigint`,
      [listingId],
    );
    await recordListingView(listingId, viewerId);
    await recordListingView(listingId, viewerId); // a repeat visit, same viewer

    const rows = await findListingsBySeller(sellerId);
    const row = rows.find((entry) => entry.id === listingId);
    expect(row?.view_count).toBe(5);
    expect(row?.viewer_count).toBe(1);
  });
});

describe("markListingSold", () => {
  it("decrements quantity by one and keeps the listing active while units remain", async () => {
    const sellerId = await seedFixtureUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTQTY multi-unit", categorySlug, quantity: 5 },
    ]);

    const first = await markListingSold(listingId);
    expect(first).toEqual({ quantity: 4, status: "active" });

    const second = await markListingSold(listingId);
    expect(second).toEqual({ quantity: 3, status: "active" });
  });

  it("flips to sold once the last unit sells, and further calls are a no-op", async () => {
    const sellerId = await seedFixtureUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTQTY single-unit", categorySlug, quantity: 1 },
    ]);

    const sold = await markListingSold(listingId);
    expect(sold).toEqual({ quantity: 0, status: "sold" });

    // Already sold — must not decrement again or go negative.
    const again = await markListingSold(listingId);
    expect(again).toBeNull();

    const { rows } = await query<{ quantity: number; status: string }>(
      `SELECT quantity, status::text FROM listings WHERE id = $1::bigint`,
      [listingId],
    );
    expect(rows[0]).toEqual({ quantity: 0, status: "sold" });
  });
});

describe("sweepExpiredListings", () => {
  it("flips only active listings whose expiry has passed, leaving everything else untouched", async () => {
    const sellerId = await seedFixtureUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const now = Date.now();

    const [pastExpiry, futureExpiry, alreadySold] = await seedListings(sellerId, [
      {
        title: "ZZZVITESTEXPIRY past",
        categorySlug,
        status: "active",
        expiresAt: new Date(now - 60 * 60 * 1000), // an hour ago
      },
      {
        title: "ZZZVITESTEXPIRY future",
        categorySlug,
        status: "active",
        expiresAt: new Date(now + 60 * 60 * 1000), // an hour from now
      },
      {
        title: "ZZZVITESTEXPIRY sold",
        categorySlug,
        status: "sold",
        expiresAt: new Date(now - 60 * 60 * 1000), // also past, but already sold
      },
    ]);

    const swept = await sweepExpiredListings();
    expect(swept).toBeGreaterThanOrEqual(1);

    const { rows } = await query<{ id: string; status: string }>(
      `SELECT id::text, status::text FROM listings WHERE id = ANY($1::bigint[])`,
      [[pastExpiry, futureExpiry, alreadySold]],
    );
    const statusOf = (id: string) => rows.find((row) => row.id === id)?.status;

    expect(statusOf(pastExpiry)).toBe("expired");
    expect(statusOf(futureExpiry)).toBe("active"); // not due yet — untouched
    expect(statusOf(alreadySold)).toBe("sold"); // sold takes priority — never reverted to expired
  });
});
