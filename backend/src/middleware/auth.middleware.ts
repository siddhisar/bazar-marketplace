/**
 * "Middleware" here means a function that runs before a route's real handler
 * and can stop the request early. These two are used in routes/index.ts by
 * listing them before the actual controller, e.g.:
 *   router.patch("/listings/:id", requireAuth, requireListingOwner, patchListing)
 * Express runs them in order — only if `requireAuth` calls `next()` does
 * `requireListingOwner` run, and only if that also calls `next()` does
 * `patchListing` (the real work) run at all.
 *
 * Guards for the endpoints that need a signed-in user, and for the ones that
 * need the signed-in user to *own* the thing being changed.
 *
 * There is one kind of account, so "seller" is never a role to check here — it
 * is a relationship to a row. Posting needs nothing more than a session;
 * changing a listing needs `listings.seller_id` to be the session's user.
 */
import type { Request, Response, NextFunction } from "express";
import { findListingOwnerId } from "../repositories/marketplace.repository";
import { sendError } from "../utils/response";

/**
 * Rejects anyone without a session.
 *
 * 401, not 403: the request has not been refused on its merits, it simply has
 * not said who it is. The client turns this into a log-in prompt.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session.userId) {
    sendError(res, 401, "Log in to continue.");
    return;
  }
  next();
}

/**
 * Rejects anyone who is not the owner of the listing at `:id`.
 *
 * Runs after `requireAuth`, and is the server-side half of "only the seller who
 * created a listing may edit or delete it" — hiding the buttons in React is a
 * courtesy, this is the rule.
 *
 * A listing that does not exist is a 404 rather than a 403: telling a stranger
 * "that exists but is not yours" is more than they need to know, and the two
 * cases are indistinguishable to someone probing ids.
 */
export async function requireListingOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (typeof rawId !== "string" || !/^\d+$/.test(rawId)) {
      sendError(res, 404, "Listing not found");
      return;
    }

    const ownerId = await findListingOwnerId(rawId);
    if (ownerId === null) {
      sendError(res, 404, "Listing not found");
      return;
    }

    if (ownerId !== req.session.userId) {
      sendError(res, 403, "That listing belongs to someone else.");
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
