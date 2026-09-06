/**
 * Turns marketplace listing rows into the shapes the API returns.
 *
 * Prices arrive from pg as strings (NUMERIC has no lossless JS number) and are
 * converted once here so the frontend never has to think about it.
 */
import {
  countAllListings,
  countListings,
  findCategoriesWithCounts,
  findListingById,
  findListings,
} from "../repositories/marketplace.repository";
import { findListingViewers } from "../repositories/listingViews.repository";
import { resolveImagePath } from "../utils/images";
import type {
  DashboardDTO,
  ListingCategoryDTO,
  ListingDetailDTO,
  ListingDTO,
  ListingPageDTO,
  ListingViewerDTO,
} from "../types/dto";

/** How many recent listings the homepage grid shows. */
const DASHBOARD_RECENT_LIMIT = 10;

/**
 * Dashboard cache.
 *
 * The payload is identical for every visitor (nothing here is scoped to a
 * session), and the Welcome page and the Home page each request it one
 * navigation apart — every "Browse marketplace" click was paying for the same
 * three-query round trip twice, plus paying it again for the next visitor to
 * land on either page within the same few seconds. A short TTL absorbs all of
 * that at the cost of the homepage's counts and "fresh listings" being up to
 * this many seconds stale, which nothing on the page depends on being
 * second-accurate.
 */
const DASHBOARD_CACHE_MS = 30_000;
let dashboardCache: { at: number; value: Promise<DashboardDTO> } | null = null;

const PLACEHOLDER_IMAGE = "/images/product-slim-fit-tee.jpg";

/** A listing with no photo rows still needs something to render. */
const imageOrPlaceholder = (path: string | null): string =>
  resolveImagePath(path ?? PLACEHOLDER_IMAGE);

/**
 * Hides all but the last two digits of a phone number, for the teaser shown
 * before "Contact Seller" is pressed.
 *
 * The full number travels in the same response too (see `ListingSellerDTO.phone`,
 * sourced from this listing's own `contact_phone` — see listing.controller.ts
 * and its column comment in marketplace.sql) — SellerCard.tsx is what gates
 * it behind a click, not the server withholding it. This is a UI reveal
 * gesture, not an access-control boundary; a real "keep it server-side until
 * asked for" version would need its own endpoint.
 */
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `${"•".repeat(Math.max(digits.length - 2, 2))}${digits.slice(-2)}`;
}

/**
 * One page of active listings plus the total, so the UI can show "N results"
 * and know whether another page exists.
 *
 * `limit` is clamped to 60 so a hand-edited query string cannot ask for the
 * whole table in one response.
 */
export async function listListings(options: {
  categorySlug?: string;
  audience?: string;
  page: number;
  perPage: number;
}): Promise<ListingPageDTO> {
  const perPage = Math.min(Math.max(options.perPage, 1), 60);
  const page = Math.max(options.page, 1);

  const [rows, total] = await Promise.all([
    findListings({
      categorySlug: options.categorySlug,
      audience: options.audience,
      limit: perPage,
      offset: (page - 1) * perPage,
    }),
    countListings({
      categorySlug: options.categorySlug,
      audience: options.audience,
    }),
  ]);

  const items: ListingDTO[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category_slug,
    categoryLabel: row.category_label,
    audience: row.audience,
    brand: row.brand,
    size: row.size,
    colour: row.colour,
    condition: row.condition,
    price: Number(row.price),
    city: row.city,
    location: row.location,
    postedAt: row.posted_at.toISOString(),
    image: imageOrPlaceholder(row.image),
  }));

  return {
    items,
    total,
    page,
    perPage,
    hasMore: page * perPage < total,
  };
}

/** A single listing with all of its photos, or null when the id is unknown. */
export async function getListing(id: string): Promise<ListingDetailDTO | null> {
  const row = await findListingById(id);
  if (!row) return null;

  const images = row.images.length > 0 ? row.images : [PLACEHOLDER_IMAGE];

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category_slug,
    categoryLabel: row.category_label,
    audience: row.audience,
    brand: row.brand,
    size: row.size,
    colour: row.colour,
    condition: row.condition,
    price: Number(row.price),
    city: row.city,
    location: row.location,
    postedAt: row.posted_at.toISOString(),
    image: imageOrPlaceholder(row.image),
    images: images.map(resolveImagePath),
    seller: {
      sellerId: row.seller_id,
      name: row.seller_name,
      memberSince: row.seller_created_at.toISOString(),
      phoneMasked: maskPhone(row.seller_phone),
      phone: row.seller_phone,
      contactEmail: row.seller_contact_email,
    },
    viewCount: row.view_count,
    status: row.status,
    quantity: row.quantity,
  };
}

/**
 * Who has viewed one listing — owner-only; the controller reaches this only
 * after requireListingOwner has already confirmed the caller is that
 * listing's seller (routes/index.ts).
 */
export async function getListingViewers(id: string): Promise<ListingViewerDTO[]> {
  const rows = await findListingViewers(id);
  return rows.map((row) => ({
    viewerId: row.viewer_id,
    name: row.display_name,
    viewedAt: row.last_viewed_at.toISOString(),
  }));
}

/**
 * The homepage payload.
 *
 * Composed from the same two functions the dedicated endpoints use rather than
 * given its own queries, so the homepage can never disagree with /api/listings
 * or /api/listing-categories about what is on the site.
 *
 * `totalActive` is the count that comes back with the first page, so counting
 * costs nothing extra here.
 */
export async function getDashboard(): Promise<DashboardDTO> {
  if (dashboardCache && Date.now() - dashboardCache.at < DASHBOARD_CACHE_MS) {
    return dashboardCache.value;
  }

  const value = (async () => {
    const [recent, categories, totalListings] = await Promise.all([
      listListings({ page: 1, perPage: DASHBOARD_RECENT_LIMIT }),
      listListingCategories(),
      countAllListings(),
    ]);

    return {
      totalActive: recent.total,
      totalListings,
      recent: recent.items,
      categories,
    };
  })();

  // A failed build must not be cached, or one blip breaks the homepage for
  // the next 30 seconds. Dropping it lets the next request retry immediately.
  value.catch(() => {
    if (dashboardCache?.value === value) dashboardCache = null;
  });

  dashboardCache = { at: Date.now(), value };
  return value;
}

/** Browsable categories with live listing counts. */
export async function listListingCategories(
  audience?: string,
): Promise<ListingCategoryDTO[]> {
  const rows = await findCategoriesWithCounts(audience);
  return rows.map((row) => ({
    slug: row.slug,
    label: row.label,
    audience: row.audience,
    total: row.total,
    image: imageOrPlaceholder(row.image),
  }));
}
