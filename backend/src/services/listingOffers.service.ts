/**
 * Business rules for the "Make an Offer" feature, between the controller and
 * the repository's raw SQL.
 *
 * Every function here returns a small discriminated result — `{ ok: true, ... }`
 * or `{ ok: false, reason }` — rather than throwing. Turning a `reason` into an
 * HTTP status and a message is the controller's job (see offer.controller.ts);
 * this layer only decides *whether* something is allowed, using authenticated
 * ids the controller already derived from the session, never anything a
 * request body could claim.
 */
import {
  counterOffer,
  createOffer,
  findOfferById,
  findOfferableListing,
  findOffersForBuyer,
  findOffersForSeller,
  hasPendingOffer,
  respondToOffer,
  updateOfferPrice,
  type OfferRow,
} from "../repositories/listingOffers.repository";
import { resolveImagePath } from "../utils/images";
import type { OfferDTO } from "../types/dto";

const PLACEHOLDER_IMAGE = "/images/product-slim-fit-tee.jpg";

const toDTO = (row: OfferRow): OfferDTO => ({
  id: row.id,
  listingId: row.listing_id,
  listingTitle: row.listing_title,
  listingImage: resolveImagePath(row.listing_image ?? PLACEHOLDER_IMAGE),
  listingPrice: Number(row.listing_price),
  listingStatus: row.listing_status,
  offeredPrice: Number(row.offered_price),
  counterPrice: row.counter_price === null ? null : Number(row.counter_price),
  status: row.status,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export type OfferFailureReason =
  | "not_found"
  | "inactive"
  | "own_listing"
  | "duplicate"
  | "forbidden"
  | "conflict";

export type OfferResult =
  | { ok: true; offer: OfferDTO }
  | { ok: false; reason: OfferFailureReason };

/**
 * A buyer proposes a price on an active listing that is not their own, and
 * that they do not already have a pending offer on.
 */
export async function createOfferForBuyer(input: {
  listingId: string;
  buyerId: number;
  offeredPrice: number;
}): Promise<OfferResult> {
  const listing = await findOfferableListing(input.listingId);
  if (!listing) return { ok: false, reason: "not_found" };

  // Only an active listing may receive new offers — sold, expired listings
  // (and anything else the enum ever grows) are refused here, not just hidden
  // in the UI.
  if (listing.status !== "active") return { ok: false, reason: "inactive" };

  if (listing.sellerId === input.buyerId) {
    return { ok: false, reason: "own_listing" };
  }

  if (await hasPendingOffer(input.listingId, input.buyerId)) {
    return { ok: false, reason: "duplicate" };
  }

  const id = await createOffer({
    listingId: input.listingId,
    buyerId: input.buyerId,
    sellerId: listing.sellerId,
    offeredPrice: input.offeredPrice,
  });

  const offer = await findOfferById(id);
  // Cannot actually be missing — it was just inserted — but satisfies the
  // type without a non-null assertion.
  if (!offer) return { ok: false, reason: "not_found" };
  return { ok: true, offer: toDTO(offer) };
}

export async function getOffersForBuyer(buyerId: number): Promise<OfferDTO[]> {
  return (await findOffersForBuyer(buyerId)).map(toDTO);
}

export async function getOffersForSeller(sellerId: number): Promise<OfferDTO[]> {
  return (await findOffersForSeller(sellerId)).map(toDTO);
}

/**
 * Accepts or rejects an offer, on behalf of whichever side's turn it is to
 * answer — see `respondToOffer` in the repository for exactly what that
 * means. `userId` is never trusted as a claimed identity; it is the session's
 * own id, passed down from the controller.
 */
export async function respondToOfferAsUser(
  offerId: string,
  userId: number,
  action: "accept" | "reject",
): Promise<OfferResult> {
  const newStatus = action === "accept" ? "accepted" : "rejected";
  const updated = await respondToOffer(offerId, userId, newStatus);

  if (updated) {
    const offer = await findOfferById(offerId);
    if (!offer) return { ok: false, reason: "not_found" };
    return { ok: true, offer: toDTO(offer) };
  }

  return await explainRespondFailure(offerId, userId, action);
}

/**
 * The buyer revises their own still-pending offer — e.g. raising ₹500 to
 * ₹700 before the seller has responded. Same shape as `respondToOfferAsUser`:
 * try the single authorizing UPDATE first, and only pay for a read-only
 * lookup to explain *why* on the failure path.
 */
export async function updateOfferAsBuyer(
  offerId: string,
  buyerId: number,
  offeredPrice: number,
): Promise<OfferResult> {
  const updated = await updateOfferPrice(offerId, buyerId, offeredPrice);

  if (updated) {
    const offer = await findOfferById(offerId);
    if (!offer) return { ok: false, reason: "not_found" };
    return { ok: true, offer: toDTO(offer) };
  }

  const offer = await findOfferById(offerId);
  if (!offer) return { ok: false, reason: "not_found" };
  if (offer.buyer_id !== buyerId) return { ok: false, reason: "forbidden" };
  return { ok: false, reason: "conflict" };
}

/** The seller counters a still-pending offer with a different price. */
export async function counterOfferAsSeller(
  offerId: string,
  sellerId: number,
  counterPrice: number,
): Promise<OfferResult> {
  const updated = await counterOffer(offerId, sellerId, counterPrice);

  if (updated) {
    const offer = await findOfferById(offerId);
    if (!offer) return { ok: false, reason: "not_found" };
    return { ok: true, offer: toDTO(offer) };
  }

  const offer = await findOfferById(offerId);
  if (!offer) return { ok: false, reason: "not_found" };
  if (offer.status !== "pending") return { ok: false, reason: "conflict" };
  if (offer.seller_id !== sellerId) return { ok: false, reason: "forbidden" };
  if (offer.listing_status !== "active") return { ok: false, reason: "inactive" };
  return { ok: false, reason: "conflict" };
}

/**
 * Why an accept/reject matched no row — read-only, and only ever run after
 * the write above already found nothing to update, so it costs nothing on
 * the common (successful) path.
 */
async function explainRespondFailure(
  offerId: string,
  userId: number,
  action: "accept" | "reject",
): Promise<OfferResult> {
  const offer = await findOfferById(offerId);
  if (!offer) return { ok: false, reason: "not_found" };

  if (offer.status !== "pending" && offer.status !== "countered") {
    return { ok: false, reason: "conflict" };
  }

  const expectedResponder =
    offer.status === "pending" ? offer.seller_id : offer.buyer_id;
  if (expectedResponder !== userId) return { ok: false, reason: "forbidden" };

  // Right party, offer still looked answerable — the only other thing
  // `respondToOffer` additionally requires for an accept is the listing
  // still being active, so that's what's left to blame.
  if (action === "accept" && offer.listing_status !== "active") {
    return { ok: false, reason: "inactive" };
  }

  // The caller is the right party and the status still looked answerable a
  // moment ago — a concurrent response beat this one to it.
  return { ok: false, reason: "conflict" };
}
