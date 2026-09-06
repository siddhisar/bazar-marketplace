/**
 * "Make an Offer": a buyer proposes a price on a listing, and the seller
 * accepts, rejects, or counters it.
 *
 * Every handler here runs behind `requireAuth` (see routes/index.ts), so
 * `req.session.userId` is always present. That id is what identifies the
 * caller everywhere below — never a buyer/seller id read from the request
 * body or the URL — which is what makes it impossible for one account to act
 * as another.
 */
import type { Request, Response, NextFunction } from "express";
import {
  createOfferForBuyer,
  counterOfferAsSeller,
  getOffersForBuyer,
  getOffersForSeller,
  respondToOfferAsUser,
  updateOfferAsBuyer,
  type OfferFailureReason,
} from "../services/listingOffers.service";
import { isValidListingId, parseOfferPrice } from "../validators/offer.validator";
import { sendError, sendSuccess } from "../utils/response";

const userIdOf = (req: Request): number => req.session.userId as number;

const REASON_STATUS: Record<OfferFailureReason, number> = {
  not_found: 404,
  inactive: 409,
  own_listing: 403,
  duplicate: 409,
  forbidden: 403,
  conflict: 409,
};

const REASON_MESSAGE: Record<OfferFailureReason, string> = {
  not_found: "Listing or offer not found.",
  inactive: "This listing is no longer accepting offers.",
  own_listing: "You cannot make an offer on your own listing.",
  duplicate: "You already have a pending offer on this listing.",
  forbidden: "You cannot do that.",
  conflict: "This offer has already been responded to.",
};

/** Sends the right status/message for a failed offer action, or the offer itself. */
function reply(
  res: Response,
  result:
    | { ok: true; offer: unknown }
    | { ok: false; reason: OfferFailureReason },
  successStatus = 200,
): void {
  if (!result.ok) {
    sendError(res, REASON_STATUS[result.reason], REASON_MESSAGE[result.reason]);
    return;
  }
  sendSuccess(res, result.offer, successStatus);
}

const offerIdParam = (req: Request): string | null => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return typeof id === "string" && /^\d+$/.test(id) ? id : null;
};

/** POST /api/offers { listingId, offeredPrice } — the signed-in user makes an offer. */
export async function postOffer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = (req.body ?? {}) as { listingId?: unknown; offeredPrice?: unknown };
    const listingId = typeof body.listingId === "string" ? body.listingId : String(body.listingId ?? "");
    if (!isValidListingId(listingId)) {
      sendError(res, 400, "A valid listingId is required.");
      return;
    }

    const offeredPrice = parseOfferPrice(body.offeredPrice);
    if (offeredPrice === null) {
      sendError(res, 400, "Enter a valid offer amount greater than ₹0.");
      return;
    }

    const result = await createOfferForBuyer({
      listingId,
      buyerId: userIdOf(req),
      offeredPrice,
    });
    reply(res, result, 201);
  } catch (err) {
    next(err);
  }
}

/** GET /api/offers/mine — the signed-in buyer's own offers, newest activity first. */
export async function getMyOffers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, await getOffersForBuyer(userIdOf(req)));
  } catch (err) {
    next(err);
  }
}

/** GET /api/offers/received — offers made on the signed-in seller's own listings. */
export async function getReceivedOffers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, await getOffersForSeller(userIdOf(req)));
  } catch (err) {
    next(err);
  }
}

/** POST /api/offers/:id/accept */
export async function postOfferAccept(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = offerIdParam(req);
    if (!id) {
      sendError(res, 404, "Offer not found.");
      return;
    }
    reply(res, await respondToOfferAsUser(id, userIdOf(req), "accept"));
  } catch (err) {
    next(err);
  }
}

/** POST /api/offers/:id/reject */
export async function postOfferReject(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = offerIdParam(req);
    if (!id) {
      sendError(res, 404, "Offer not found.");
      return;
    }
    reply(res, await respondToOfferAsUser(id, userIdOf(req), "reject"));
  } catch (err) {
    next(err);
  }
}

/** POST /api/offers/:id/update { offeredPrice } — buyer only, and only while pending. */
export async function postOfferUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = offerIdParam(req);
    if (!id) {
      sendError(res, 404, "Offer not found.");
      return;
    }

    const offeredPrice = parseOfferPrice((req.body ?? {}).offeredPrice);
    if (offeredPrice === null) {
      sendError(res, 400, "Enter a valid offer amount greater than ₹0.");
      return;
    }

    reply(res, await updateOfferAsBuyer(id, userIdOf(req), offeredPrice));
  } catch (err) {
    next(err);
  }
}

/** POST /api/offers/:id/counter { counterPrice } — seller only, and only while pending. */
export async function postOfferCounter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = offerIdParam(req);
    if (!id) {
      sendError(res, 404, "Offer not found.");
      return;
    }

    const counterPrice = parseOfferPrice((req.body ?? {}).counterPrice);
    if (counterPrice === null) {
      sendError(res, 400, "Enter a valid counter amount greater than ₹0.");
      return;
    }

    reply(res, await counterOfferAsSeller(id, userIdOf(req), counterPrice));
  } catch (err) {
    next(err);
  }
}
