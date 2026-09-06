/**
 * Display formatting shared by the listing UI.
 *
 * These moved out of `data/marketplace.ts` during the migration to the API.
 * They are pure functions over values the backend returns, with no fixture data
 * behind them, so components can keep using them without importing mock
 * listings to get at them.
 */

const DAY = 24 * 60 * 60 * 1000;

/** How long a listing stays live before it drops out of search. */
export const LISTING_LIFETIME_DAYS = 45;

/** Turns a timestamp into "2 days ago" for listing cards. */
export function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const days = Math.floor(elapsed / DAY);

  if (days <= 0) {
    const hours = Math.floor(elapsed / (60 * 60 * 1000));
    if (hours <= 0) return "Just now";
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/** Expiry date shown on the seller dashboard. */
export function expiryDate(iso: string): string {
  const expires = new Date(new Date(iso).getTime() + LISTING_LIFETIME_DAYS * DAY);
  return expires.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "Member since August 2026", from an ISO timestamp. */
export function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

/** ₹48,000 — no decimals, since no listing is priced in paise. */
export function formatPrice(price: number): string {
  if (price === 0) return "Contact for details";
  return `₹${price.toLocaleString("en-IN")}`;
}

/**
 * Where a listing is, as one line.
 *
 * `location` is the neighbourhood and is null on every seeded row — the column
 * exists but was deliberately not backfilled with invented areas. When it is
 * missing the city stands alone rather than leaving a dangling comma.
 */
export function placeLabel(location: string | null, city: string): string {
  return location ? `${location}, ${city}` : city;
}
