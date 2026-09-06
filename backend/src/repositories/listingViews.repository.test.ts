import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTestDatabase,
  disconnectTestDatabase,
  pickCategorySlugs,
  seedFixtureUser,
  seedListings,
  wipeFixtures,
} from "../test/fixtures";
import { findListingViewers, recordListingView } from "./listingViews.repository";
import { query } from "../config/database";

/** A second fixture account, distinct from the seller fixture, standing in
 *  for "someone who viewed the listing" — reserved email/cleanup mirrors
 *  fixtures.ts's own convention for its one seller user. */
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

describe("recordListingView / findListingViewers", () => {
  it("records a viewer and returns their name and a timestamp", async () => {
    const sellerId = await seedFixtureUser();
    const viewerId = await seedViewerUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTVIEWS single viewer", categorySlug },
    ]);

    await recordListingView(listingId, viewerId);

    const viewers = await findListingViewers(listingId);
    expect(viewers).toHaveLength(1);
    expect(viewers[0].viewer_id).toBe(viewerId);
    expect(viewers[0].display_name).toBe("Vitest Viewer");
    expect(viewers[0].last_viewed_at).toBeInstanceOf(Date);
  });

  it("does not duplicate a row for the same viewer's repeat visits", async () => {
    const sellerId = await seedFixtureUser();
    const viewerId = await seedViewerUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTVIEWS repeat viewer", categorySlug },
    ]);

    await recordListingView(listingId, viewerId);
    await recordListingView(listingId, viewerId);
    await recordListingView(listingId, viewerId);

    const viewers = await findListingViewers(listingId);
    expect(viewers).toHaveLength(1);
  });

  it("keeps two different viewers of the same listing as two separate rows", async () => {
    const sellerId = await seedFixtureUser();
    const viewerId = await seedViewerUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTVIEWS two viewers", categorySlug },
    ]);

    // The seller's own fixture user, standing in for a second distinct
    // visitor here — what matters is two different ids, not who they are.
    await recordListingView(listingId, viewerId);
    await recordListingView(listingId, sellerId);

    const viewers = await findListingViewers(listingId);
    expect(viewers.map((v) => v.viewer_id).sort()).toEqual(
      [viewerId, sellerId].sort(),
    );
  });

  it("returns nothing for a listing no one has viewed", async () => {
    const sellerId = await seedFixtureUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTVIEWS no viewers", categorySlug },
    ]);

    expect(await findListingViewers(listingId)).toEqual([]);
  });

  it("keeps two different listings' viewers completely separate", async () => {
    const sellerId = await seedFixtureUser();
    const viewerId = await seedViewerUser();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingA, listingB] = await seedListings(sellerId, [
      { title: "ZZZVITESTVIEWS listing A", categorySlug },
      { title: "ZZZVITESTVIEWS listing B", categorySlug },
    ]);

    await recordListingView(listingA, viewerId);

    expect(await findListingViewers(listingA)).toHaveLength(1);
    expect(await findListingViewers(listingB)).toEqual([]);
  });
});
