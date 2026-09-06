/**
 * Saved listings and saved searches for the signed-in user.
 *
 * Every handler here runs behind `requireAuth`, so `req.session.userId` is
 * always present. That id — never anything from the request — is what scopes the
 * queries, which is what stops one user reaching another's saved data.
 *
 * "Saved listings" is a simple bookmark list (which listing ids this user
 * tapped the heart/save icon on). "Saved searches" is different: it stores a
 * search itself (e.g. "bikes under 5000 in Pune") so the user can re-run it
 * later or get a "new since you last checked" count — that's what
 * `seenCount` / `lastCheckedAt` below are for.
 */
import type { Request, Response, NextFunction } from "express";
import {
  addSavedListing,
  createSavedSearch,
  deleteSavedSearch,
  listSavedListingIds,
  listSavedSearches,
  markSavedSearchViewed,
  removeSavedListing,
  type SavedSearchRow,
} from "../repositories/saved.repository";
import { sendError, sendSuccess } from "../utils/response";

/** The session user id, guaranteed present because requireAuth ran first. */
const userIdOf = (req: Request): number => req.session.userId as number;

/** A listing id from a path/body is a bigint; validate it is all digits. */
const isValidListingId = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value);

/* ---------------------------------------------------------- saved listings */

/** GET /api/saved-listings — the user's saved listing ids, newest first. */
export async function getSavedListings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, { ids: await listSavedListingIds(userIdOf(req)) });
  } catch (err) {
    next(err);
  }
}

/** POST /api/saved-listings { listingId } — saves a listing. */
export async function postSavedListing(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const listingId = (req.body ?? {}).listingId;
    if (!isValidListingId(String(listingId))) {
      sendError(res, 400, "A valid listingId is required.");
      return;
    }

    const ok = await addSavedListing(userIdOf(req), String(listingId));
    if (!ok) {
      sendError(res, 404, "That listing does not exist.");
      return;
    }
    sendSuccess(res, { saved: true }, 201);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/saved-listings/:id — unsaves a listing. */
export async function deleteSavedListing(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isValidListingId(id)) {
      sendError(res, 400, "A valid listing id is required.");
      return;
    }
    await removeSavedListing(userIdOf(req), id);
    sendSuccess(res, { saved: false });
  } catch (err) {
    next(err);
  }
}

/* ---------------------------------------------------------- saved searches */

/** The API shape of a saved search — the row, with dates as ISO strings. */
const toDTO = (row: SavedSearchRow) => ({
  id: String(row.id),
  name: row.name,
  query: row.query,
  seenCount: row.seen_count,
  lastCheckedAt: row.last_viewed_at.toISOString(),
  createdAt: row.created_at.toISOString(),
});

/** GET /api/saved-searches — the user's saved searches, newest first. */
export async function getSavedSearches(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rows = await listSavedSearches(userIdOf(req));
    sendSuccess(res, rows.map(toDTO));
  } catch (err) {
    next(err);
  }
}

/** POST /api/saved-searches { name, query, seenCount } — saves a search. */
export async function postSavedSearch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = (req.body ?? {}) as {
      name?: unknown;
      query?: unknown;
      seenCount?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const searchQuery = typeof body.query === "string" ? body.query : "";
    const seenCount =
      Number.isInteger(body.seenCount) && (body.seenCount as number) >= 0
        ? (body.seenCount as number)
        : 0;

    if (!name) {
      sendError(res, 400, "A name is required to save a search.");
      return;
    }

    const row = await createSavedSearch({
      userId: userIdOf(req),
      name,
      query: searchQuery,
      seenCount,
    });
    sendSuccess(res, toDTO(row), 201);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/saved-searches/:id — deletes a saved search the user owns. */
export async function deleteSavedSearchById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      sendError(res, 404, "Saved search not found.");
      return;
    }

    const deleted = await deleteSavedSearch(userIdOf(req), id);
    if (!deleted) {
      // Either it never existed or it is someone else's — indistinguishable
      // on purpose, so a probe learns nothing about other users' rows.
      sendError(res, 404, "Saved search not found.");
      return;
    }
    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

/** POST /api/saved-searches/:id/viewed { seenCount } — resets the "new" badge. */
export async function postSavedSearchViewed(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      sendError(res, 404, "Saved search not found.");
      return;
    }

    const seenCount = Number((req.body ?? {}).seenCount);
    const safeCount = Number.isInteger(seenCount) && seenCount >= 0 ? seenCount : 0;

    const ok = await markSavedSearchViewed(userIdOf(req), id, safeCount);
    if (!ok) {
      sendError(res, 404, "Saved search not found.");
      return;
    }
    sendSuccess(res, { viewed: true });
  } catch (err) {
    next(err);
  }
}
