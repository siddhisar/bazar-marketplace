/**
 * Listing writes, and the seller's own feed.
 *
 * Every handler here is mounted behind `requireAuth`, and every one that names
 * an existing listing is also behind `requireListingOwner`. That middleware —
 * not anything in this file, and certainly nothing in React — is what enforces
 * "only the seller who created a listing may change it".
 *
 * Each function below is a controller: it reads the incoming `req` (params in
 * the URL, `req.body` for the JSON the client sent, `req.session` for who is
 * signed in), asks a validator or repository to do the actual work, and sends
 * a `res` back. The repeated `try { ... } catch (err) { next(err) }` shape
 * means any unexpected error (a bad SQL value, a dropped connection) is
 * handed to Express's centralised error handler instead of crashing the
 * process or leaving the request hanging with no response.
 */
import type { Request, Response, NextFunction } from "express";
import {
  createListing,
  deleteListing,
  findListingsBySeller,
  markListingSold,
  renewListing,
  updateListing,
} from "../repositories/listingWrite.repository";
import { getListing, getListingViewers } from "../services/marketplace.service";
import {
  checkCategory,
  parseListingPatch,
  parseNewListing,
} from "../validators/listing.validator";
import { resolveImagePath } from "../utils/images";
import { sendError, sendSuccess } from "../utils/response";

const PLACEHOLDER = "/images/api/placeholder-other-1.svg";

/** GET /api/listings/mine — the signed-in user's own listings, any status. */
export async function getMyListings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await findListingsBySeller(req.session.userId!);

    sendSuccess(
      res,
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        category: row.category_slug,
        categoryLabel: row.category_label,
        subcategory: row.subcategory_slug,
        audience: row.audience,
        brand: row.brand,
        size: row.size,
        colour: row.colour,
        condition: row.condition,
        price: Number(row.price),
        quantity: row.quantity,
        city: row.city,
        location: row.location,
        postedAt: row.posted_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        status: row.status,
        viewCount: row.view_count,
        // The number "who viewed this listing" can actually list by name —
        // see viewer_count's own comment in listingWrite.repository.ts for
        // why this is not the same as viewCount above.
        viewerCount: row.viewer_count,
        image: resolveImagePath(row.image ?? PLACEHOLDER),
      })),
    );
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/listings/:id/viewers — owner only.
 *
 * requireListingOwner (routes/index.ts) has already confirmed the session
 * owns this listing before this runs, so there's nothing further to check
 * here — the id in the URL is enough.
 */
export async function getListingViewersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    sendSuccess(res, await getListingViewers(id));
  } catch (err) {
    next(err);
  }
}

/** POST /api/listings — creates one owned by the session's user. */
export async function postListing(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = parseNewListing(req.body);
    if ("error" in parsed) {
      sendError(res, 400, parsed.error);
      return;
    }

    const categoryError = await checkCategory(
      parsed.value.categorySlug,
      parsed.value.subcategorySlug,
    );
    if (categoryError) {
      sendError(res, 400, categoryError);
      return;
    }

    // seller_id comes from the session and is never read from the body.
    const id = await createListing({
      ...parsed.value,
      sellerId: req.session.userId!,
    });

    sendSuccess(res, await getListing(id), 201);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/listings/:id — owner only. */
export async function patchListing(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = parseListingPatch(req.body);
    if ("error" in parsed) {
      sendError(res, 400, parsed.error);
      return;
    }

    // Only validate the pair when the category itself is being changed.
    if (parsed.value.categorySlug !== undefined) {
      const categoryError = await checkCategory(
        parsed.value.categorySlug,
        parsed.value.subcategorySlug ?? null,
      );
      if (categoryError) {
        sendError(res, 400, categoryError);
        return;
      }
    }

    const id = req.params.id as string;
    if (!(await updateListing(id, parsed.value))) {
      sendError(res, 400, "Nothing to update.");
      return;
    }

    sendSuccess(res, await getListing(id));
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/listings/:id — owner only. Photos cascade. */
export async function removeListing(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await deleteListing(req.params.id as string);
    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

/** POST /api/listings/:id/sold — owner only. */
export async function postListingSold(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    await markListingSold(id);
    sendSuccess(res, await getListing(id));
  } catch (err) {
    next(err);
  }
}

/** POST /api/listings/:id/renew — owner only. Refuses on a sold listing. */
export async function postListingRenew(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    if (!(await renewListing(id))) {
      sendError(res, 409, "A sold listing cannot be renewed.");
      return;
    }
    sendSuccess(res, await getListing(id));
  } catch (err) {
    next(err);
  }
}
