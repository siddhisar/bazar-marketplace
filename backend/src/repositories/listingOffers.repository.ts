/**
 * Data access for buyer offers on listings — see marketplace.sql for the
 * `listing_offers` table this reads and writes.
 *
 * As with every other repository, nothing here glues user-supplied values
 * into SQL text; every value is a bind parameter.
 *
 * Ownership and "whose turn is it to respond" are enforced by the WHERE
 * clause of a single UPDATE, not by reading a row first and deciding in
 * JavaScript — that would leave a gap between the check and the write that a
 * second concurrent request could land in. Each write function returns
 * whether it matched a row; the service layer only does a second, read-only
 * query to explain *why* nothing changed, for the error message.
 */
import { query } from "../config/database";

export type OfferStatus = "pending" | "accepted" | "rejected" | "countered";

export type OfferRow = {
  id: string;
  listing_id: string;
  buyer_id: number;
  seller_id: number;
  offered_price: string;
  counter_price: string | null;
  status: OfferStatus;
  created_at: Date;
  updated_at: Date;
  listing_title: string;
  listing_price: string;
  listing_status: string;
  listing_image: string | null;
};

const OFFER_COLUMNS = `
  o.id::text, o.listing_id::text, o.buyer_id, o.seller_id,
  o.offered_price, o.counter_price, o.status::text,
  o.created_at, o.updated_at,
  l.title AS listing_title, l.price AS listing_price, l.status::text AS listing_status,
  (
    SELECT COALESCE(thumb_path, path) FROM listing_photos
    WHERE listing_id = l.id
    ORDER BY is_primary DESC, position ASC
    LIMIT 1
  ) AS listing_image
`;

/** Just enough of a listing to decide whether an offer may be made on it. */
export async function findOfferableListing(
  listingId: string,
): Promise<{ sellerId: number; status: string; price: string } | null> {
  const { rows } = await query<{ seller_id: number; status: string; price: string }>(
    `SELECT seller_id, status::text, price FROM listings WHERE id = $1::bigint`,
    [listingId],
  );
  const row = rows[0];
  return row ? { sellerId: row.seller_id, status: row.status, price: row.price } : null;
}

/** Whether this buyer already has an offer on this listing still awaiting the seller. */
export async function hasPendingOffer(
  listingId: string,
  buyerId: number,
): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM listing_offers
      WHERE listing_id = $1::bigint AND buyer_id = $2 AND status = 'pending'
      LIMIT 1`,
    [listingId, buyerId],
  );
  return rows.length > 0;
}

/** One offer, with the listing details a card needs — null if the id does not exist. */
export async function findOfferById(id: string): Promise<OfferRow | null> {
  const { rows } = await query<OfferRow>(
    `SELECT ${OFFER_COLUMNS}
       FROM listing_offers o
       JOIN listings l ON l.id = o.listing_id
      WHERE o.id = $1::bigint`,
    [id],
  );
  return rows[0] ?? null;
}

/** A buyer's own offers, newest activity first. */
export async function findOffersForBuyer(buyerId: number): Promise<OfferRow[]> {
  const { rows } = await query<OfferRow>(
    `SELECT ${OFFER_COLUMNS}
       FROM listing_offers o
       JOIN listings l ON l.id = o.listing_id
      WHERE o.buyer_id = $1
      ORDER BY o.updated_at DESC`,
    [buyerId],
  );
  return rows;
}

/** Offers made on a seller's own listings, newest activity first. */
export async function findOffersForSeller(sellerId: number): Promise<OfferRow[]> {
  const { rows } = await query<OfferRow>(
    `SELECT ${OFFER_COLUMNS}
       FROM listing_offers o
       JOIN listings l ON l.id = o.listing_id
      WHERE o.seller_id = $1
      ORDER BY o.updated_at DESC`,
    [sellerId],
  );
  return rows;
}

/** Creates a pending offer. Returns the new row's id. */
export async function createOffer(input: {
  listingId: string;
  buyerId: number;
  sellerId: number;
  offeredPrice: number;
}): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO listing_offers (listing_id, buyer_id, seller_id, offered_price)
     VALUES ($1::bigint, $2, $3, $4)
     RETURNING id::text`,
    [input.listingId, input.buyerId, input.sellerId, input.offeredPrice],
  );
  return rows[0].id;
}

/**
 * Accepts or rejects an offer, on behalf of whichever side's turn it is to
 * answer: a `pending` offer awaits the seller (the buyer proposed it), a
 * `countered` one awaits the buyer (the seller proposed the counter). The
 * WHERE clause below is that rule expressed directly in SQL, so a request
 * from the wrong side, or one that arrives after the offer was already
 * resolved, simply matches no row rather than needing a separate check first.
 *
 * Accepting additionally requires the listing to still be `active` — with
 * quantity>1, a seller can have several offers pending at once, and one of
 * them selling out the listing (via "Mark as sold", or another offer being
 * accepted first) must not leave a stale offer acceptable for stock that no
 * longer exists. Rejecting carries no such requirement: declining an offer
 * on a listing that has since sold out is still a safe, honest thing to do.
 *
 * @returns true if a row was updated.
 */
export async function respondToOffer(
  offerId: string,
  userId: number,
  newStatus: "accepted" | "rejected",
): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `UPDATE listing_offers
        SET status = $3::offer_status, updated_at = now()
      WHERE id = $1::bigint
        AND (
          (status = 'pending' AND seller_id = $2) OR
          (status = 'countered' AND buyer_id = $2)
        )
        AND (
          $3::text <> 'accepted'
          OR EXISTS (
            SELECT 1 FROM listings l
             WHERE l.id = listing_offers.listing_id AND l.status = 'active'
          )
        )
      RETURNING id::text`,
    [offerId, userId, newStatus],
  );
  return rows.length > 0;
}

/**
 * The buyer revises their own still-pending offer to a different price —
 * raising it to be more competitive, or lowering it, before the seller has
 * responded. Only valid from `pending` and only for the offer's own buyer,
 * the same "encode the rule in the WHERE clause" pattern as every other
 * write here: once the seller has responded (accepted/rejected/countered),
 * there is nothing left to revise — the buyer's reply to a counter goes
 * through `respondToOffer` instead, not this.
 *
 * @returns true if a row was updated.
 */
export async function updateOfferPrice(
  offerId: string,
  buyerId: number,
  offeredPrice: number,
): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `UPDATE listing_offers
        SET offered_price = $3, updated_at = now()
      WHERE id = $1::bigint AND buyer_id = $2 AND status = 'pending'
      RETURNING id::text`,
    [offerId, buyerId, offeredPrice],
  );
  return rows.length > 0;
}

/**
 * The seller counters a still-pending offer with a different price.
 *
 * Only valid from `pending` — a counter is the seller's one reply to the
 * buyer's original number; there is no counter-to-a-counter here (see the
 * table comment in marketplace.sql), which is what keeps this a price
 * negotiation and not a message thread. Also requires the listing to still
 * be `active` — countering proposes a sale, same as accepting, so it makes
 * no sense once nothing is left to sell (see respondToOffer's own comment).
 *
 * @returns true if a row was updated.
 */
export async function counterOffer(
  offerId: string,
  sellerId: number,
  counterPrice: number,
): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `UPDATE listing_offers
        SET status = 'countered', counter_price = $3, updated_at = now()
      WHERE id = $1::bigint AND seller_id = $2 AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM listings l
           WHERE l.id = listing_offers.listing_id AND l.status = 'active'
        )
      RETURNING id::text`,
    [offerId, sellerId, counterPrice],
  );
  return rows.length > 0;
}
