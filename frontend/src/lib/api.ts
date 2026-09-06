/**
 * Every server call the frontend makes.
 *
 * Listings, search, facet counts and categories all come from the API now;
 * `data/marketplace.ts` is no longer a data source for them. Each response
 * shape below mirrors a DTO in `backend/src/types/dto.ts`, so a change there
 * shows up here as a type error rather than as undefined at runtime.
 */

/**
 * Base URL of the backend API. Override with VITE_API_URL in a .env file.
 *
 * Empty by default in a production build, not the backend's own origin: the
 * deployed frontend reaches the API through its own domain's `/api/...` and
 * `/images/...` (see vercel.json), which Vercel then proxies straight
 * through to the backend. That is what makes the session cookie same-site
 * from the browser's point of view — calling the backend's origin directly
 * would make it a cross-site cookie instead, which some browsers' privacy
 * settings (Safari's cross-site tracking prevention, Firefox strict mode,
 * "block third-party cookies") refuse to keep, silently signing someone out
 * on the very next reload. Dev keeps the old default: there is no Vercel
 * proxy on `vite dev`, so it has to name the backend directly.
 */
const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  (import.meta.env.DEV ? "http://localhost:5000" : "");

type ApiEnvelope<T> = { success: boolean; data: T; message?: string };

/** The signed-in user, as /api/auth/me reports them. */
export type AuthUser = {
  id: number;
  email: string;
  name: string;
};

/**
 * Every request goes through here.
 *
 * The API is on a different origin in development, so `credentials: "include"`
 * is required or the browser omits the session cookie and the server sees a
 * stranger. Reads do not need the cookie, but sending it costs nothing and
 * keeps one code path.
 *
 * Throws with the server's own message when a request fails, since that wording
 * is written to be read by a person; a network failure or non-JSON response
 * becomes a generic message rather than an unhandled parse error.
 *
 * `<T>` is a generic type parameter: this one function handles every kind of
 * request the app makes (fetching a listing, logging in, saving a search),
 * and `T` is filled in by each caller (e.g. `apiRequest<AuthUser>(...)`) to
 * say what shape of data comes back, so the caller gets a typed result
 * instead of `any`. Inside, `await fetch(...)` pauses this function until the
 * network response arrives (without blocking the rest of the app — other
 * code keeps running while this waits), and `await res.json()` similarly
 * waits for the response body to be parsed from JSON text into a real
 * JavaScript object.
 */
async function apiRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? "GET",
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    /* fetch rejects — rather than resolving with a status — when the request
       never reached a server at all: the API is down, the machine is offline, or
       the origin was refused by CORS. The browser's own wording for all of that
       is "Failed to fetch", which every page then displayed verbatim, and it
       reads like the app is broken rather than the server being unreachable.
       Nothing here can distinguish those causes (the browser deliberately
       withholds the detail), so this names the likely one and points at
       something checkable. */
    throw new Error(
      API_BASE
        ? `Cannot reach the server at ${API_BASE}. Check that the backend is running, then try again.`
        : "Cannot reach the server. Check your connection, then try again.",
    );
  }

  // A 500 behind a proxy, or a dropped connection, can produce a body that is
  // not JSON at all. Falling back keeps the thrown error readable either way.
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !body?.success) {
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return body.data;
}

export const fetchCurrentUser = () => apiRequest<AuthUser | null>("/api/auth/me");

export const registerUser = (input: {
  name: string;
  email: string;
  password: string;
}) => apiRequest<AuthUser>("/api/auth/register", { method: "POST", body: input });

export const loginUser = (input: { email: string; password: string }) =>
  apiRequest<AuthUser>("/api/auth/login", { method: "POST", body: input });

export const logoutUser = () =>
  apiRequest<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST" });

/** Which third-party sign-ins the server actually has credentials for. */
export const fetchAuthProviders = () =>
  apiRequest<{ google: boolean }>("/api/auth/providers");

/**
 * A link, not a fetch: the browser itself must visit Google.
 *
 * `returnTo` — the page sign-in was started from — travels as a query param
 * here because that's the only channel available: the browser is about to
 * leave the SPA entirely (Google, then the backend's callback) and come back
 * days-of-round-trips later as a fresh page load, so no in-memory React state
 * survives the trip. The backend validates it's an internal path before
 * storing or using it — see getGoogleStart/getGoogleCallback.
 */
export const googleSignInUrl = (returnTo?: string): string =>
  `${API_BASE}/api/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;

/**
 * One type-ahead suggestion — a category or subcategory to navigate into.
 * Mirrors the server's SuggestionDTO. `subcategorySlug` is null for a
 * top-level category match; when set, `categorySlug`/`categoryLabel` are that
 * subcategory's parent.
 */
export type ApiSuggestion = {
  categorySlug: string;
  categoryLabel: string;
  subcategorySlug: string | null;
  subcategoryLabel: string | null;
};

/**
 * Type-ahead suggestions for a partial query, from the database.
 *
 * Takes an AbortSignal because these fire while someone types: without one, a
 * slow reply for "iph" can land after the reply for "iphone" and repopulate the
 * dropdown with staler matches than what is in the box.
 *
 * Its own fetch rather than `apiRequest` so an abort can be told apart from a
 * real failure — cancelling is the expected outcome for most of these calls, and
 * must not surface as an error.
 */
export async function fetchSuggestions(
  q: string,
  signal?: AbortSignal,
): Promise<ApiSuggestion[]> {
  const res = await fetch(
    `${API_BASE}/api/search/suggest?q=${encodeURIComponent(q)}`,
    { signal },
  );

  const body = (await res.json().catch(() => null)) as ApiEnvelope<
    ApiSuggestion[]
  > | null;

  // A failed suggestion lookup is not worth interrupting typing over; the box
  // simply shows nothing.
  if (!res.ok || !body?.success) return [];
  return body.data;
}

/* ------------------------------------------------------------------ listings */

/** A listing as it appears in a grid. Mirrors ListingDTO. */
export type ApiListing = {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  audience: string;
  brand: string | null;
  size: string | null;
  colour: string | null;
  condition: string;
  price: number;
  city: string;
  /** Neighbourhood, or null when the listing records only a city. */
  location: string | null;
  postedAt: string;
  image: string;
};

/**
 * Just the fields a grid card renders.
 *
 * `ApiListing` satisfies this, which is what the migrated pages pass. It exists
 * as its own type so the card states what it actually needs rather than
 * demanding a whole listing — the Search page still supplies rows from
 * `lib/search.ts` while its migration is finished, and those satisfy this too.
 */
export type ListingCardData = Pick<
  ApiListing,
  | "id"
  | "title"
  | "image"
  | "condition"
  | "price"
  | "categoryLabel"
  | "location"
  | "city"
  | "postedAt"
>;

/** Mirrors ListingSellerDTO. */
export type ApiSeller = {
  /** Needed only to hide "Make an Offer" on the seller's own listing. */
  sellerId: number;
  name: string;
  memberSince: string;
  /** Masked teaser shown before "Contact Seller" is pressed. */
  phoneMasked: string | null;
  /** Full number, for the actual `tel:` link once revealed. */
  phone: string | null;
  /** Public contact address, distinct from the seller's sign-in email. */
  contactEmail: string | null;
};

/** Mirrors ListingDetailDTO. */
export type ApiListingDetail = ApiListing & {
  description: string;
  images: string[];
  seller: ApiSeller;
  viewCount: number;
  status: string;
  /** How many units remain — 0 once the listing has sold out. */
  quantity: number;
};

export type ApiCategory = {
  slug: string;
  label: string;
  audience: string;
  total: number;
  image: string;
};

export type ApiDashboard = {
  totalActive: number;
  /** Every listing ever posted, regardless of status — the homepage's "total" figure. */
  totalListings: number;
  recent: ApiListing[];
  categories: ApiCategory[];
};

export type ApiFacetValue = { value: string; label: string; count: number };

export type ApiFacets = {
  category: ApiFacetValue[];
  audience: ApiFacetValue[];
  city: ApiFacetValue[];
  condition: ApiFacetValue[];
  size: ApiFacetValue[];
  colour: ApiFacetValue[];
  /** Price bands, keyed by band id (e.g. "5000-20000"). */
  price: ApiFacetValue[];
};

export type ApiSearchResult = {
  items: ApiListing[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  sort: string;
  /** True when the exact search missed and trigram similarity was used. */
  fuzzy: boolean;
  /** Closest real title to a misspelled query, for "did you mean". */
  suggestion: string | null;
  /**
   * Set when the query matched no listing text at all but names a real
   * category/subcategory ("mobile" -> Mobiles) — `items`/`total`/`facets`
   * above are then that category's own listings, not a text match. Present
   * so the results page can say so and move the address bar to a normal
   * category browse instead of carrying the dead-end query forward.
   */
  categoryFallback: {
    categorySlug: string;
    categoryLabel: string;
    subcategorySlug: string | null;
    subcategoryLabel: string | null;
  } | null;
  facets: ApiFacets;
  /** Resume points for Next/Previous — see `SearchParams.cursor`. */
  nextCursor: string | null;
  prevCursor: string | null;
};

export type ApiListingPage = {
  items: ApiListing[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
};

/**
 * Points an image path at the API origin.
 *
 * The server stores and returns paths like `/images/foo.jpg`, which are correct
 * relative to *it*. Left alone in the browser they resolve against the Vite dev
 * origin instead, where the SPA fallback answers with index.html — a 200 that
 * is not an image, so every picture silently fails to decode rather than
 * erroring visibly.
 *
 * Applied at the fetch boundary below rather than in each component, so a new
 * component cannot forget it. Absolute URLs are passed through untouched.
 */
export const imageUrl = (path: string): string =>
  /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`;

/**
 * Inverse of `imageUrl` — recovers the server-relative `/images/...` path a
 * listing write actually stores, from the absolute URL a fetched listing's
 * `images` array carries. Needed only when re-submitting an existing photo
 * unchanged (editing a listing): the server's own path validator refuses
 * anything that is not already one of its own `/images/...` paths.
 */
export const imagePath = (url: string): string =>
  url.startsWith(API_BASE) ? url.slice(API_BASE.length) : url;

const withImage = <T extends { image: string }>(listing: T): T => ({
  ...listing,
  image: imageUrl(listing.image),
});

/**
 * Dashboard cache — the same pattern as `fetchCategories` below, and for the
 * same reason: the Welcome page and the Home page both render this data one
 * navigation apart (Welcome fetches it for its floating listing cards, Home
 * fetches it again moments later for the page itself), so without this every
 * "Browse marketplace" click paid for the identical request twice. Storing
 * the in-flight promise, not just the resolved value, also means the two
 * calls that really do land in the same tick (StrictMode's double-invoke in
 * dev, or a fast remount) share one request instead of firing two.
 */
const DASHBOARD_TTL_MS = 20_000;
let dashboardCache: { at: number; value: Promise<ApiDashboard> } | null = null;

/** Everything the homepage renders, in one round trip. */
export const fetchDashboard = async (): Promise<ApiDashboard> => {
  if (dashboardCache && Date.now() - dashboardCache.at < DASHBOARD_TTL_MS) {
    return dashboardCache.value;
  }

  const value = apiRequest<ApiDashboard>("/api/dashboard").then((data) => ({
    ...data,
    recent: data.recent.map(withImage),
    categories: data.categories.map(withImage),
  }));

  // A failed request must not be cached, or one blip disables the homepage
  // for the next 20 seconds. Dropping it lets the next caller retry immediately.
  value.catch(() => {
    if (dashboardCache?.value === value) dashboardCache = null;
  });

  dashboardCache = { at: Date.now(), value };
  return value;
};

/**
 * Category list cache.
 *
 * The category tree is reference data asked for by almost every page, and the
 * search page requests it alongside its results — so without this the two
 * compete for the same database connections and each makes the other slower.
 *
 * Keyed by audience, and the in-flight promise is what gets stored rather than
 * the resolved value: two components mounting in the same tick then share one
 * request instead of firing two. Held for a minute, because the counts on each
 * category do move as listings are posted — long enough to take the request off
 * the path of a browsing session, short enough that the numbers stay honest.
 */
const CATEGORIES_TTL_MS = 60_000;
const categoriesCache = new Map<
  string,
  { at: number; value: Promise<ApiCategory[]> }
>();

export const fetchCategories = async (audience?: string) => {
  const key = audience ?? "";
  const hit = categoriesCache.get(key);
  if (hit && Date.now() - hit.at < CATEGORIES_TTL_MS) return hit.value;

  const value = apiRequest<ApiCategory[]>(
    `/api/listing-categories${audience ? `?audience=${encodeURIComponent(audience)}` : ""}`,
  ).then((data) => data.map(withImage));

  // A failed request must not be cached, or one blip disables categories for a
  // minute. Dropping the entry lets the next caller retry immediately.
  value.catch(() => categoriesCache.delete(key));

  categoriesCache.set(key, { at: Date.now(), value });
  return value;
};

export const fetchListings = async (params: {
  category?: string;
  audience?: string;
  page?: number;
  perPage?: number;
}): Promise<ApiListingPage> => {
  const data = await apiRequest<ApiListingPage>(`/api/listings?${toQuery(params)}`);
  return { ...data, items: data.items.map(withImage) };
};

export const fetchListing = async (id: string): Promise<ApiListingDetail> => {
  const data = await apiRequest<ApiListingDetail>(
    `/api/listings/${encodeURIComponent(id)}`,
  );
  return { ...withImage(data), images: data.images.map(imageUrl) };
};

/**
 * Faceted search. Every filter, the sort and the page are the server's job —
 * the frontend sends the query string and renders what comes back.
 *
 * Repeatable filters (condition, size, colour, city, priceBand) are passed as
 * arrays and serialised as repeated keys, which is what the validator expects.
 */
export const searchListings = async (
  params: SearchParams,
): Promise<ApiSearchResult> => {
  const data = await apiRequest<ApiSearchResult>(
    `/api/search/listings?${toQuery(params)}`,
  );
  return { ...data, items: data.items.map(withImage) };
};

export type SearchParams = {
  q?: string;
  category?: string | string[];
  subcategory?: string;
  audience?: string;
  city?: string | string[];
  condition?: string | string[];
  size?: string | string[];
  colour?: string | string[];
  priceBand?: string | string[];
  minPrice?: number;
  maxPrice?: number;
  postedWithin?: number;
  sort?: string;
  page?: number;
  perPage?: number;
  /** A previous response's `nextCursor`/`prevCursor`, paired with its direction. */
  cursor?: string;
  cursorDir?: "next" | "prev";
  /** Echoed back from page 1's own `fuzzy` — see `SearchParams.fuzzy` in lib/search.ts. */
  fuzzy?: boolean;
};

/**
 * Turns a params object into a query string, dropping anything empty so the URL
 * carries only filters that are actually set.
 */
function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined && entry !== null && entry !== "") {
          search.append(key, String(entry));
        }
      }
      continue;
    }

    search.set(key, String(value));
  }

  return search.toString();
}

/* --------------------------------------------------------- listing writes */

/** A listing as its owner sees it — includes sold and expired. */
export type ApiMyListing = ApiListing & {
  description: string;
  subcategory: string | null;
  expiresAt: string;
  status: string;
  viewCount: number;
  /**
   * Distinct signed-in, non-owner viewers — what the "who viewed this
   * listing" modal can actually list by name. Not the same as viewCount
   * above, which also counts the seller's own visits and anonymous ones;
   * this is the number the My Listings table shows and opens the modal
   * from, so what's clicked always matches what the modal can back up.
   */
  viewerCount: number;
  /** How many units remain — 0 once the listing has sold out. */
  quantity: number;
};

export type NewListingBody = {
  title: string;
  description: string;
  /** Main category slug. Required — the subcategory is not. */
  category: string;
  subcategory?: string;
  condition: string;
  price: number;
  /** How many units this listing represents. */
  quantity: number;
  city: string;
  location?: string;
  /** Paths returned by uploadListingImages, not arbitrary URLs. */
  images: string[];
  /**
   * The seller's own contact number. Lives on the account, not this one
   * listing — see the backend's setUserPhone — so submitting it here updates
   * what every listing of this seller's shows, not just this one.
   */
  phone: string;
};

/**
 * The signed-in user's own listings.
 *
 * No user id is sent: the server reads it from the session, so this cannot be
 * pointed at somebody else's listings by changing a parameter.
 */
export const fetchMyListings = async (): Promise<ApiMyListing[]> => {
  const data = await apiRequest<ApiMyListing[]>("/api/listings/mine");
  return data.map(withImage);
};

/** Mirrors ListingViewerDTO — one signed-in visitor of the seller's own listing. */
export type ApiListingViewer = {
  viewerId: number;
  name: string;
  viewedAt: string;
};

/**
 * Who has viewed one of the signed-in seller's own listings.
 *
 * No listing id sent alongside an owner check on the client: the server's
 * requireListingOwner refuses this for any listing that isn't the caller's
 * own, same as edit/delete.
 */
export const fetchListingViewers = (id: string) =>
  apiRequest<ApiListingViewer[]>(`/api/listings/${encodeURIComponent(id)}/viewers`);

export const createListing = (body: NewListingBody) =>
  apiRequest<ApiListingDetail>("/api/listings", { method: "POST", body });

export const updateListing = (id: string, body: Partial<NewListingBody>) =>
  apiRequest<ApiListingDetail>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });

export const deleteListing = (id: string) =>
  apiRequest<{ deleted: boolean }>(`/api/listings/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const markListingSold = (id: string) =>
  apiRequest<ApiListingDetail>(`/api/listings/${encodeURIComponent(id)}/sold`, {
    method: "POST",
  });

export const renewListing = (id: string) =>
  apiRequest<ApiListingDetail>(`/api/listings/${encodeURIComponent(id)}/renew`, {
    method: "POST",
  });

/* ------------------------------------------------------------- saved data */

/*
 * Saved listings and saved searches. All of these require a session; the server
 * answers 401 otherwise, which surfaces here as a thrown error the caller treats
 * as "not signed in". The data is keyed to the account server-side, which is what
 * makes it appear on any browser the user logs in from.
 */

/** The ids of the listings the signed-in user has saved. */
export const fetchSavedListingIds = async (): Promise<string[]> => {
  const data = await apiRequest<{ ids: string[] }>("/api/saved-listings");
  return data.ids;
};

export const saveListing = (listingId: string) =>
  apiRequest<{ saved: boolean }>("/api/saved-listings", {
    method: "POST",
    body: { listingId },
  });

export const unsaveListing = (listingId: string) =>
  apiRequest<{ saved: boolean }>(
    `/api/saved-listings/${encodeURIComponent(listingId)}`,
    { method: "DELETE" },
  );

/** A saved search as the API returns it. Mirrors the server's toDTO. */
export type ApiSavedSearch = {
  id: string;
  name: string;
  query: string;
  seenCount: number;
  lastCheckedAt: string;
  createdAt: string;
};

export const fetchSavedSearches = () =>
  apiRequest<ApiSavedSearch[]>("/api/saved-searches");

export const createSavedSearch = (input: {
  name: string;
  query: string;
  seenCount: number;
}) =>
  apiRequest<ApiSavedSearch>("/api/saved-searches", {
    method: "POST",
    body: input,
  });

export const deleteSavedSearch = (id: string) =>
  apiRequest<{ deleted: boolean }>(
    `/api/saved-searches/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );

export const markSavedSearchViewed = (id: string, seenCount: number) =>
  apiRequest<{ viewed: boolean }>(
    `/api/saved-searches/${encodeURIComponent(id)}/viewed`,
    { method: "POST", body: { seenCount } },
  );

/* ------------------------------------------------------------------- offers */

export type ApiOfferStatus = "pending" | "accepted" | "rejected" | "countered";

/** A buyer's price offer on a listing. Mirrors OfferDTO — the same shape for
 *  both the buyer's "My Offers" and the seller's "Offers Received". */
export type ApiOffer = {
  id: string;
  listingId: string;
  listingTitle: string;
  listingImage: string;
  listingPrice: number;
  listingStatus: string;
  offeredPrice: number;
  counterPrice: number | null;
  status: ApiOfferStatus;
  createdAt: string;
  updatedAt: string;
};

const withOfferImage = (offer: ApiOffer): ApiOffer => ({
  ...offer,
  listingImage: imageUrl(offer.listingImage),
});

/** Makes an offer on a listing. Requires a session; the server assigns the buyer. */
export const createOffer = (listingId: string, offeredPrice: number) =>
  apiRequest<ApiOffer>("/api/offers", {
    method: "POST",
    body: { listingId, offeredPrice },
  }).then((offer) => withOfferImage(offer));

/** The signed-in user's own offers, newest activity first. */
export const fetchMyOffers = async (): Promise<ApiOffer[]> => {
  const data = await apiRequest<ApiOffer[]>("/api/offers/mine");
  return data.map(withOfferImage);
};

/** Offers made on the signed-in user's own listings. */
export const fetchReceivedOffers = async (): Promise<ApiOffer[]> => {
  const data = await apiRequest<ApiOffer[]>("/api/offers/received");
  return data.map(withOfferImage);
};

export const acceptOffer = (id: string) =>
  apiRequest<ApiOffer>(`/api/offers/${encodeURIComponent(id)}/accept`, {
    method: "POST",
  }).then((offer) => withOfferImage(offer));

export const rejectOffer = (id: string) =>
  apiRequest<ApiOffer>(`/api/offers/${encodeURIComponent(id)}/reject`, {
    method: "POST",
  }).then((offer) => withOfferImage(offer));

export const counterOffer = (id: string, counterPrice: number) =>
  apiRequest<ApiOffer>(`/api/offers/${encodeURIComponent(id)}/counter`, {
    method: "POST",
    body: { counterPrice },
  }).then((offer) => withOfferImage(offer));

/** The buyer revises their own still-pending offer to a different price. */
export const updateOffer = (id: string, offeredPrice: number) =>
  apiRequest<ApiOffer>(`/api/offers/${encodeURIComponent(id)}/update`, {
    method: "POST",
    body: { offeredPrice },
  }).then((offer) => withOfferImage(offer));

/* -------------------------------------------------------------------- upload */

export type UploadedImage = { path: string };

/** Matches the server's own cap, so the UI can refuse before uploading. */
export const MAX_LISTING_PHOTOS = 8;

/**
 * Uploads listing photos and returns the paths the server stored them at.
 *
 * Multipart, so no Content-Type header is set by hand — the browser has to add
 * the multipart boundary itself. Requires a session; the server answers 401
 * otherwise and that surfaces as a thrown error here.
 */
export async function uploadListingImages(
  files: File[],
): Promise<UploadedImage[]> {
  const form = new FormData();
  for (const file of files) form.append("photos", file);

  // Same unreachable-server case as apiRequest — see the note there.
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/listings/images`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
  } catch {
    throw new Error(
      API_BASE
        ? `Cannot reach the server at ${API_BASE}. Check that the backend is running, then try again.`
        : "Cannot reach the server. Check your connection, then try again.",
    );
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<{
    images: UploadedImage[];
  }> | null;

  if (!res.ok || !body?.success) {
    throw new Error(body?.message ?? `Upload failed (${res.status})`);
  }
  return body.data.images;
}
