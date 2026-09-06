/**
 * Shapes returned by the API (what the frontend consumes).
 *
 * "DTO" = Data Transfer Object: a plain type describing exactly what crosses
 * the network, kept separate from the database row types in the repository
 * files. A repository row can carry internal detail (a password hash, a raw
 * Postgres column name); a DTO carries only what the frontend is meant to
 * see, named the way the frontend expects (camelCase, not snake_case). The
 * `to DTO`-style functions in the service layer are what convert one into
 * the other.
 *
 * A few of the paging fields recur across these types — `total`, `page`,
 * `perPage`, `hasMore`. They exist because a listings grid cannot render
 * "Page 3 of 12" or a working Next button from just the current page's rows;
 * the frontend needs the total count and where it stands within it, and
 * fetching that also requires another query, which is why it comes back
 * bundled with the page instead of being computed on the client.
 */

/** A marketplace listing as it appears in a results grid. */
export type ListingDTO = {
  id: string;
  title: string;
  /** Category slug, e.g. "womens-dresses". */
  category: string;
  /** Human label for that slug, e.g. "Dresses". */
  categoryLabel: string;
  audience: string;
  brand: string | null;
  size: string | null;
  colour: string | null;
  condition: string;
  price: number;
  city: string;
  /**
   * Neighbourhood within `city`, or null when the listing has none recorded.
   * Seeded rows are city-level only, so this is null for all of them.
   */
  location: string | null;
  postedAt: string;
  /** Primary photo, already resolved to a servable path. */
  image: string;
};

/** Who a listing belongs to, as much of them as a buyer may see. */
export type ListingSellerDTO = {
  /** Needed client-side only to hide "Make an Offer" from the listing's own owner. */
  sellerId: number;
  name: string;
  /** ISO timestamp of the account's creation, for "Member since". */
  memberSince: string;
  /** Partly hidden contact number, for the teaser shown before "Contact Seller" is pressed. */
  phoneMasked: string | null;
  /**
   * Full contact number, or null when the seller has none on file. Only sent
   * so the "Contact Seller" reveal has something real to show and dial — see
   * SellerCard.tsx, which still gates it behind an explicit click rather than
   * displaying it immediately.
   */
  phone: string | null;
  /**
   * Public contact email for "Contact Seller", or null when unset. Never the
   * account's sign-in email — see the `contact_email` column comment in
   * marketplace.sql for why those are kept separate.
   */
  contactEmail: string | null;
};

/** A listing on its own page: everything above plus body copy and all photos. */
export type ListingDetailDTO = ListingDTO & {
  description: string;
  images: string[];
  seller: ListingSellerDTO;
  viewCount: number;
  status: string;
  /** How many units remain — see the `quantity` column's comment in marketplace.sql. */
  quantity: number;
};

/** One page of listings plus enough context to render paging controls. */
export type ListingPageDTO = {
  items: ListingDTO[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
};

/**
 * Everything the homepage needs, in one round trip.
 *
 * Bundled rather than left as three calls because the page cannot render
 * usefully without all of it, and three requests would give three separate
 * loading states for one screen.
 */
export type DashboardDTO = {
  /** Active listings site-wide, for the "N listings live" line. */
  totalActive: number;
  /**
   * Every listing ever posted, regardless of status — the headline "N total
   * listings" figure. Not what search/browse/pagination should use; those
   * stay on `totalActive`-style, status-filtered counts.
   */
  totalListings: number;
  /** Newest active listings, for the "Fresh listings" grid. */
  recent: ListingDTO[];
  /** Every browsable category with its live count, for the tiles and links. */
  categories: ListingCategoryDTO[];
};

/** One stored photo, as returned by the upload endpoint. */
export type UploadedImageDTO = {
  /** Public path, ready to be saved on a listing and served back. */
  path: string;
};

/**
 * The signed-in user as the API reports them. No password hash and no provider
 * ids — the shape itself keeps those out of responses.
 */
export type AuthUserDTO = {
  id: number;
  email: string;
  name: string;
};

/** One selectable value in a filter list, with how many listings it would match. */
export type FacetValueDTO = {
  /** What to send back as the filter value. */
  value: string;
  /** What to show the shopper — equal to `value` unless a label exists. */
  label: string;
  count: number;
};

/**
 * Counts for every checkbox filter. Each group is counted with the other
 * filters applied but not its own, so the alternatives within a group stay
 * visible after one of them is picked.
 */
export type ListingFacetsDTO = {
  category: FacetValueDTO[];
  audience: FacetValueDTO[];
  city: FacetValueDTO[];
  condition: FacetValueDTO[];
  size: FacetValueDTO[];
  colour: FacetValueDTO[];
  /** Price bands, keyed by band id (e.g. "5000-20000"). */
  price: FacetValueDTO[];
};

/** A page of search results plus what the search did to produce them. */
export type ListingSearchDTO = {
  items: ListingDTO[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  sort: string;
  /** True when the exact search missed and trigram similarity was used instead. */
  fuzzy: boolean;
  /** Closest real title to a misspelled query, for "did you mean". */
  suggestion: string | null;
  /**
   * Set when the query itself matched no listing (neither exact nor fuzzy —
   * "mobile" finds no title/description that says "mobile"; every phone
   * listing names a brand and model instead) but names a real category or
   * subcategory, e.g. "Mobiles". `items`/`total`/`facets` are then that
   * category's own active listings, not a text match — the frontend uses
   * this to say so and to move the address bar to a normal category browse
   * (`?category=...`) rather than carrying the dead-end query forward.
   */
  categoryFallback: {
    categorySlug: string;
    categoryLabel: string;
    subcategorySlug: string | null;
    subcategoryLabel: string | null;
  } | null;
  facets: ListingFacetsDTO;
  /**
   * Opaque keyset tokens for the row immediately after/before this page.
   * Feed one back as `cursor` (with the matching `cursorDir`) to fetch the
   * adjacent page by index seek instead of OFFSET — `null` when this is the
   * last/first page and there is nothing to seek to.
   */
  nextCursor: string | null;
  prevCursor: string | null;
};

/** A browsable category with how many active listings it holds. */
export type ListingCategoryDTO = {
  slug: string;
  label: string;
  audience: string;
  total: number;
  image: string;
};

export type OfferStatus = "pending" | "accepted" | "rejected" | "countered";

/**
 * A buyer's price offer on a listing, from either side's point of view — the
 * same shape serves the buyer's "My Offers" and the seller's "Offers
 * Received", so the frontend has one type and one card component for both.
 */
export type OfferDTO = {
  id: string;
  listingId: string;
  listingTitle: string;
  /** Primary photo, already resolved to a servable path. */
  listingImage: string;
  /** The listing's current asking price, read fresh — never copied onto the offer row. */
  listingPrice: number;
  /** "active" once more means new actions (accept/reject/counter) are meaningful, not just visible. */
  listingStatus: string;
  offeredPrice: number;
  /** Set only once the seller counters. */
  counterPrice: number | null;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
};

/**
 * One signed-in visitor of a listing, as its owner sees them.
 *
 * Deliberately no email address — nothing else in the app exposes one
 * user's contact details to another just for having looked at something
 * (see OfferDTO above, which drops the buyer's identity entirely); a
 * display name plus when they looked is the seller-facing equivalent of
 * that same boundary, not full contact details.
 */
export type ListingViewerDTO = {
  viewerId: number;
  name: string;
  /** Most recent visit, ISO timestamp. */
  viewedAt: string;
};
