import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTestDatabase,
  disconnectTestDatabase,
  pickCategorySlugs,
  seedFixtureUser,
  seedListings,
  wipeFixtures,
} from "../test/fixtures";
import { markListingSold } from "./listingWrite.repository";
import { counterOffer, createOffer, respondToOffer } from "./listingOffers.repository";
import { query } from "../config/database";

/** A second fixture account standing in for "someone who makes an offer" —
 *  mirrors listingWrite.repository.test.ts's own VIEWER_EMAIL convention. */
const BUYER_EMAIL = "vitest-offer-buyer@example.invalid";

async function seedBuyer(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO users (email, display_name)
     VALUES ($1, 'Vitest Offer Buyer')
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [BUYER_EMAIL],
  );
  return rows[0].id;
}

async function wipeBuyer(): Promise<void> {
  await query(`DELETE FROM users WHERE email = $1`, [BUYER_EMAIL]);
}

beforeAll(async () => {
  await connectTestDatabase();
  await wipeFixtures();
  await wipeBuyer();
});

afterAll(async () => {
  await wipeFixtures();
  await wipeBuyer();
  await disconnectTestDatabase();
});

describe("respondToOffer / counterOffer require the listing to still be active to accept or counter", () => {
  it("refuses to accept an offer once the listing has sold out, but still allows rejecting it", async () => {
    const sellerId = await seedFixtureUser();
    const buyerId = await seedBuyer();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTOFFER sold-out", categorySlug, quantity: 1 },
    ]);

    const offerId = await createOffer({
      listingId,
      buyerId,
      sellerId,
      offeredPrice: 500,
    });

    // The listing sells out via a completely separate path (the seller's own
    // "Mark as sold" action) before this offer is answered.
    const sold = await markListingSold(listingId);
    expect(sold?.status).toBe("sold");

    const accepted = await respondToOffer(offerId, sellerId, "accepted");
    expect(accepted).toBe(false);

    const rejected = await respondToOffer(offerId, sellerId, "rejected");
    expect(rejected).toBe(true);
  });

  it("refuses to counter an offer once the listing has sold out", async () => {
    const sellerId = await seedFixtureUser();
    const buyerId = await seedBuyer();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTOFFER counter-sold-out", categorySlug, quantity: 1 },
    ]);

    const offerId = await createOffer({
      listingId,
      buyerId,
      sellerId,
      offeredPrice: 500,
    });

    await markListingSold(listingId);

    const countered = await counterOffer(offerId, sellerId, 600);
    expect(countered).toBe(false);
  });

  it("still allows accepting an offer on a listing that is still active", async () => {
    const sellerId = await seedFixtureUser();
    const buyerId = await seedBuyer();
    const [categorySlug] = await pickCategorySlugs(1);
    const [listingId] = await seedListings(sellerId, [
      { title: "ZZZVITESTOFFER still-active", categorySlug, quantity: 3 },
    ]);

    const offerId = await createOffer({
      listingId,
      buyerId,
      sellerId,
      offeredPrice: 500,
    });

    const accepted = await respondToOffer(offerId, sellerId, "accepted");
    expect(accepted).toBe(true);
  });
});
