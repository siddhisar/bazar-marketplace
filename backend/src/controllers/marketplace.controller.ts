/**
 * These functions are "controllers" — the layer that sits directly behind a
 * route (see routes/index.ts). A controller's job is always the same shape:
 * read what the request needs from `req`, ask a "service" file to actually
 * do the work (talk to the database, apply business rules), then send the
 * result back with `res`. The controller itself should stay thin — no SQL,
 * no business logic — that's what `services/` and `repositories/` are for.
 *
 * Every controller function here has the same three parameters:
 *   req  — the incoming HTTP request: `req.query` holds URL parameters like
 *          `?q=iphone&page=2`, `req.params` holds route parameters like the
 *          `:id` in `/listings/:id`, and `req.body` holds JSON the client sent.
 *   res  — used to send the response back, e.g. `res.json(...)`.
 *   next — call this to hand off to the next thing in the chain. Calling
 *          `next(err)` specifically skips straight to the error-handling
 *          middleware in app.ts, which is why every function below wraps its
 *          work in try/catch and calls `next(err)` in the catch block —
 *          otherwise a database error would crash the server instead of
 *          producing a clean error response.
 */
import type { Request, Response, NextFunction } from "express";
import {
  getDashboard,
  getListing,
  listListingCategories,
  listListings,
} from "../services/marketplace.service";
import { incrementListingViewCount } from "../repositories/marketplace.repository";
import { recordListingView } from "../repositories/listingViews.repository";
import {
  searchListings,
  suggestSearches,
} from "../services/listingSearch.service";
import { parseSearchRequest } from "../validators/listingSearch.validator";
import { persistUploads, uploadListingPhotos } from "../middleware/upload.middleware";
import { sendError, sendSuccess } from "../utils/response";
import type { UploadedImageDTO } from "../types/dto";

const AUDIENCES = new Set(["Men", "Women", "Unisex"]);

/** Only pass through a value the enum will accept; anything else means "all". */
function parseAudience(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalised = `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
  return AUDIENCES.has(normalised) ? normalised : undefined;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * GET /api/dashboard — everything the homepage renders, in one call.
 *
 * Carries the same Server-Timing breakdown as /api/search/listings — this is
 * the other endpoint the Welcome-to-Home transition depends on, so its cache
 * hits and misses are worth being able to see the same way.
 */
export async function getDashboardData(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dbStart = process.hrtime.bigint();
    const result = await getDashboard();
    const dbEnd = process.hrtime.bigint();

    const appStart = res.locals.startAt as bigint | undefined;
    const timings = [`db;dur=${Number(dbEnd - dbStart) / 1e6}`];
    if (appStart !== undefined) {
      timings.push(`appOverhead;dur=${Number(dbStart - appStart) / 1e6}`);
    }
    res.setHeader("Server-Timing", timings.join(", "));

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/listings/images — stores photos and returns their public paths.
 *
 * Upload is its own step, before any listing exists: the Post Ad form needs to
 * show thumbnails while it is still being filled in, and a half-written form
 * must not create a listing row. The returned paths are what a later
 * create/update call attaches to a listing.
 *
 * Behind requireAuth, so anonymous callers cannot fill the disk.
 */
export function postListingImages(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  uploadListingPhotos(req, res, (err: unknown) => {
    if (err) {
      // Multer's own errors are size/count limits and the type filter above —
      // all of them are the caller's mistake, so they are 400s with the reason.
      sendError(res, 400, err instanceof Error ? err.message : "Upload failed.");
      return;
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      sendError(res, 400, "Attach at least one photo.");
      return;
    }

    // persistUploads is async in Supabase mode (it PUTs each buffer to the
    // bucket), so a rejection goes to next() rather than being left unhandled.
    persistUploads(files)
      .then((paths) => {
        const images: UploadedImageDTO[] = paths.map((path) => ({ path }));
        sendSuccess(res, { images }, 201);
      })
      .catch(next);
  });
}

/** GET /api/listings?category=&audience=&page=&perPage= */
export async function getListings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;

    const result = await listListings({
      categorySlug: category || undefined,
      audience: parseAudience(req.query.audience),
      page: parsePositiveInt(req.query.page, 1),
      perPage: parsePositiveInt(req.query.perPage, 24),
    });

    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/listings/:id
 *
 * Also records a view: opening this endpoint is what "someone looked at this
 * listing" means, and the seller dashboard's view count (see
 * getMyListings in listing.controller.ts) reads from the same
 * `listings.view_count` column this increments.
 */
export async function getListingById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Reject anything that is not a plain integer before it reaches the query,
    // so a bad id is a 404 rather than a database error.
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (typeof rawId !== "string" || !/^\d+$/.test(rawId)) {
      sendError(res, 404, "Listing not found");
      return;
    }

    const listing = await getListing(rawId);
    if (!listing) {
      sendError(res, 404, "Listing not found");
      return;
    }

    // Best-effort: a visitor must still get the listing they asked for even
    // if this write fails, so a broken count is logged rather than turning
    // a successful read into a 500.
    try {
      await incrementListingViewCount(rawId);
    } catch (err) {
      console.error("[listing] failed to record a view", err);
    }

    // The seller's own "who viewed my listing" list — only a signed-in
    // visitor who isn't the listing's own seller counts as a viewer here;
    // an anonymous visit already has no account to attribute to, and the
    // seller opening their own listing is not someone viewing it.
    const viewerId = req.session.userId;
    if (viewerId && viewerId !== listing.seller.sellerId) {
      try {
        await recordListingView(rawId, viewerId);
      } catch (err) {
        console.error("[listing] failed to record a viewer", err);
      }
    }

    sendSuccess(res, listing);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/search/listings — this is the endpoint the whole search feature
 * runs through. This is the "Node.js route" step of the search flow:
 *
 *   Search box (React)
 *     -> fetch("/api/search/listings?q=iphone&category=mobiles&sort=newest")
 *     -> this function runs
 *     -> parseSearchRequest() turns the URL's query string into a plain object
 *     -> searchListings() (in services/listingSearch.service.ts) builds and
 *        runs the actual SQL against Postgres
 *     -> the results come back here and get sent as JSON
 *     -> React receives that JSON and renders listing cards
 *
 * `req.query` is everything after the "?" in the URL, parsed into an object
 * by Express — e.g. `?q=iphone&page=2` becomes `{ q: "iphone", page: "2" }`.
 * This function doesn't read `req.query` directly; it hands the whole thing
 * to `parseSearchRequest`, which is responsible for validating and defaulting
 * every value (see validators/listingSearch.validator.ts) — a controller
 * should never trust raw user input to already be in the right shape.
 *
 * `await searchListings(...)` pauses this function until the database query
 * finishes and the results are ready — `async`/`await` is what lets this
 * code read top-to-bottom like a normal sequence of steps, even though
 * talking to a database actually takes some (small) amount of time and
 * happens in the background.
 *
 * `Server-Timing` breaks the response down into the two phases that live in
 * this process: everything before the database calls started (CORS, session,
 * JSON body parsing, query-string validation) and the database calls
 * themselves (three, run in parallel — see `searchListings`). Added while
 * chasing the gap between millisecond-scale query costs and a much slower
 * deployed API; visible in any browser's Network tab or via
 * `curl -sD - -o /dev/null <url> | grep -i server-timing`.
 */
export async function getListingSearch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dbStart = process.hrtime.bigint();
    const results = await searchListings(parseSearchRequest(req.query));
    const dbEnd = process.hrtime.bigint();

    const appStart = res.locals.startAt as bigint | undefined;
    const timings = [`db;dur=${Number(dbEnd - dbStart) / 1e6}`];
    if (appStart !== undefined) {
      timings.push(`appOverhead;dur=${Number(dbStart - appStart) / 1e6}`);
    }
    res.setHeader("Server-Timing", timings.join(", "));

    // sendSuccess wraps the data in a consistent shape — { success: true,
    // data: ... } — so every endpoint in this API answers the same way and
    // the frontend can handle responses generically. See utils/response.ts.
    sendSuccess(res, results);
  } catch (err) {
    // Anything that went wrong above (a bad database connection, an
    // unexpected error) ends up here. next(err) skips ahead to the error
    // handler in app.ts instead of the request hanging forever.
    next(err);
  }
}

/**
 * GET /api/search/suggest?q=bicy&limit=6 — type-ahead suggestions.
 *
 * Open, like the rest of search. Answers an empty list rather than a 400 for a
 * too-short query: the box calls this while someone types, and "you have not
 * typed enough yet" is a normal state, not a client error.
 */
export async function getSearchSuggestions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

    sendSuccess(res, await suggestSearches(q, limit));
  } catch (err) {
    next(err);
  }
}

/** GET /api/listing-categories?audience=Men|Women */
export async function getListingCategories(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const categories = await listListingCategories(parseAudience(req.query.audience));
    sendSuccess(res, categories);
  } catch (err) {
    next(err);
  }
}
