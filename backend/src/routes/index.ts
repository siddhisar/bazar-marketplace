/**
 * This file is the "map" of the marketplace API. It does not contain any
 * logic itself — it just says, for each URL and HTTP method, which function
 * (called a "controller") should handle it.
 *
 * How a request flows through this file:
 *   Browser sends a request, e.g. GET /api/search/listings?q=iphone
 *     -> Express looks for a matching line below
 *     -> if the route has middleware first (like `requireAuth`), that runs
 *        first and can stop the request early (e.g. "please log in")
 *     -> otherwise the controller function runs and sends back a response
 *
 * `router.get(...)`, `router.post(...)`, `router.patch(...)` and
 * `router.delete(...)` correspond to the four HTTP methods this API uses:
 * GET to read data, POST to create something, PATCH to update part of
 * something, DELETE to remove it.
 */
import { Router } from "express";
import {
  getDashboardData,
  getListingById,
  getListingCategories,
  getListings,
  getListingSearch,
  getSearchSuggestions,
  postListingImages,
} from "../controllers/marketplace.controller";
import {
  getListingViewersHandler,
  getMyListings,
  patchListing,
  postListing,
  postListingRenew,
  postListingSold,
  removeListing,
} from "../controllers/listing.controller";
import {
  deleteSavedListing,
  deleteSavedSearchById,
  getSavedListings,
  getSavedSearches,
  postSavedListing,
  postSavedSearch,
  postSavedSearchViewed,
} from "../controllers/saved.controller";
import {
  getMyOffers,
  getReceivedOffers,
  postOffer,
  postOfferAccept,
  postOfferCounter,
  postOfferReject,
  postOfferUpdate,
} from "../controllers/offer.controller";
import { requireAuth, requireListingOwner } from "../middleware/auth.middleware";

/**
 * Marketplace API routes.
 *
 * Everything that reads is open: browsing, searching and opening a listing need
 * no account, so none of it sits behind a guard. Auth lives on its own router
 * at /api/auth.
 *
 * The one write here is the photo upload, which puts files on disk and so needs
 * a session. When create/edit/delete/mark-sold/renew arrive they belong beside
 * it — each behind `requireAuth`, and anything touching an existing listing
 * also behind `requireListingOwner`, which is the server-side form of "only the
 * seller who created a listing may change it".
 */
// Router() creates a mini-app just for defining routes. It gets attached to
// the real Express app (in app.ts) under the "/api" prefix, so a route
// written here as "/dashboard" is actually reached at "/api/dashboard".
const router = Router();

// A route can list several functions in a row, e.g.
//   router.patch("/listings/:id", requireAuth, requireListingOwner, patchListing)
// Express runs them left to right. `requireAuth` and `requireListingOwner`
// are "middleware" — functions that run before the real handler and can stop
// the request (by sending an error response) instead of letting it continue.
// Only if every middleware function calls `next()` does Express move on to
// the actual controller function at the end (here, `patchListing`).

// Everything the homepage renders, in one round trip.
router.get("/dashboard", getDashboardData);

// Marketplace listings.
// Before "/search/listings" is irrelevant — distinct paths — but grouped with it
// because both are the search surface.
router.get("/search/suggest", getSearchSuggestions);
router.get("/search/listings", getListingSearch);
router.get("/listings", getListings);
// Before "/listings/:id", or "mine" is read as an id and 404s.
router.get("/listings/mine", requireAuth, getMyListings);
router.get("/listings/:id", getListingById);
router.get("/listing-categories", getListingCategories);

// Photos are uploaded before the listing they will belong to exists, so this
// takes no listing id and only requires a session.
router.post("/listings/images", requireAuth, postListingImages);

/* Writes. Creating needs only a session — seller_id is taken from it, never
   from the body. Everything that touches an existing listing also passes
   requireListingOwner, which answers 403 when the session's user is not the
   listing's seller_id and 404 when the listing does not exist. That middleware
   is the enforcement point; the React buttons are a convenience on top of it. */
router.post("/listings", requireAuth, postListing);
router.patch("/listings/:id", requireAuth, requireListingOwner, patchListing);
router.delete("/listings/:id", requireAuth, requireListingOwner, removeListing);
router.post("/listings/:id/sold", requireAuth, requireListingOwner, postListingSold);
router.post("/listings/:id/renew", requireAuth, requireListingOwner, postListingRenew);
router.get("/listings/:id/viewers", requireAuth, requireListingOwner, getListingViewersHandler);

/* Saved listings and saved searches. Every one is behind requireAuth: these are
   per-user records, so there is no anonymous version of any of them. The handlers
   scope every query to the session's user id, which is what enforces that a user
   only ever touches their own rows — the guard here refuses a stranger, the
   query refuses another user. */
router.get("/saved-listings", requireAuth, getSavedListings);
router.post("/saved-listings", requireAuth, postSavedListing);
router.delete("/saved-listings/:id", requireAuth, deleteSavedListing);

router.get("/saved-searches", requireAuth, getSavedSearches);
router.post("/saved-searches", requireAuth, postSavedSearch);
router.delete("/saved-searches/:id", requireAuth, deleteSavedSearchById);
router.post("/saved-searches/:id/viewed", requireAuth, postSavedSearchViewed);

/* Offers. Every route is behind requireAuth: there is no anonymous offer.
   Ownership of an *offer* (as opposed to a listing) is enforced inside the
   service/repository, not by a route-level guard — accepting or rejecting one
   is only valid for whichever side's turn it is to answer, which depends on
   the offer's current status, not a single fixed owner column the way a
   listing has. See listingOffers.service.ts. */
router.post("/offers", requireAuth, postOffer);
router.get("/offers/mine", requireAuth, getMyOffers);
router.get("/offers/received", requireAuth, getReceivedOffers);
router.post("/offers/:id/accept", requireAuth, postOfferAccept);
router.post("/offers/:id/reject", requireAuth, postOfferReject);
router.post("/offers/:id/counter", requireAuth, postOfferCounter);
router.post("/offers/:id/update", requireAuth, postOfferUpdate);

export default router;
