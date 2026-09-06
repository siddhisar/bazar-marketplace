/**
 * Validation for listing writes.
 *
 * Everything a client sends is treated as hostile: `seller_id` and `status` are
 * not read at all — ownership comes from the session and status only changes
 * through its own endpoints, so neither can be set by hand in a request body.
 */
import { query } from "../config/database";

export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 4000;
export const MAX_PRICE = 100_000_000;
export const MAX_PHOTOS = 8;
export const MAX_QUANTITY = 100_000;

const CONDITIONS = ["New with tags", "Like new", "Good", "Fair"];

/** A bare 10-digit Indian mobile number: trunk codes/landlines are not this. */
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Strips everything but digits, then a leading `+91`/`91`/`0` trunk prefix if
 * present, down to the bare 10 digits stored and displayed everywhere else.
 * Returns null for anything that still isn't a valid Indian mobile number
 * once stripped, so the same function both validates and normalises.
 */
export function normalizeIndianMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return INDIAN_MOBILE_RE.test(digits) ? digits : null;
}

export type Parsed<T> = { value: T } | { error: string };

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

export type NewListingInput = {
  title: string;
  description: string;
  categorySlug: string;
  subcategorySlug: string | null;
  condition: string;
  price: number;
  /** How many units this listing represents — see the column's comment in marketplace.sql. */
  quantity: number;
  city: string;
  location: string | null;
  images: string[];
  /**
   * This listing's own contact number, normalised to 10 bare digits — see
   * the `contact_phone` column's comment in marketplace.sql for why it
   * lives on the listing rather than the seller's account.
   */
  phone: string;
};

/**
 * Photo paths must be ones this server issued.
 *
 * The upload endpoint returns `/images/...` paths; accepting an arbitrary
 * string here would let a caller point a listing at any URL on the internet,
 * which is both an SSRF-shaped hazard and a way to embed tracking pixels in
 * someone else's search results.
 */
const isOwnImagePath = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\/images\/[A-Za-z0-9._/-]+$/.test(value) &&
  !value.includes("..");

function parseCore(
  input: Record<string, unknown>,
  partial: boolean,
): Parsed<Partial<NewListingInput>> {
  const out: Partial<NewListingInput> = {};

  if (!partial || input.title !== undefined) {
    const title = asString(input.title).trim();
    if (title.length < 3) return { error: "Give the listing a title." };
    if (title.length > MAX_TITLE) return { error: "That title is too long." };
    out.title = title;
  }

  if (!partial || input.description !== undefined) {
    const description = asString(input.description).trim();
    if (description.length < 10) {
      return { error: "Add a short description of the item." };
    }
    if (description.length > MAX_DESCRIPTION) {
      return { error: "That description is too long." };
    }
    out.description = description;
  }

  if (!partial || input.category !== undefined) {
    const category = asString(input.category).trim();
    if (!category) return { error: "Choose a category." };
    out.categorySlug = category;
  }

  if (input.subcategory !== undefined) {
    const sub = asString(input.subcategory).trim();
    out.subcategorySlug = sub === "" ? null : sub;
  }

  if (!partial || input.condition !== undefined) {
    const condition = asString(input.condition).trim();
    if (!CONDITIONS.includes(condition)) return { error: "Choose a condition." };
    out.condition = condition;
  }

  if (!partial || input.price !== undefined) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < 0) return { error: "Enter a valid price." };
    if (price > MAX_PRICE) return { error: "That price is too high." };
    out.price = Math.round(price);
  }

  if (!partial || input.quantity !== undefined) {
    const quantity = Number(input.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { error: "Enter how many are available (at least 1)." };
    }
    if (quantity > MAX_QUANTITY) return { error: "That quantity is too high." };
    out.quantity = quantity;
  }

  if (!partial || input.city !== undefined) {
    const city = asString(input.city).trim();
    if (!city) return { error: "Where is the item?" };
    out.city = city;
  }

  if (input.location !== undefined) {
    const location = asString(input.location).trim();
    out.location = location === "" ? null : location;
  }

  if (!partial || input.phone !== undefined) {
    const raw = asString(input.phone).trim();
    if (!raw) return { error: "Add a contact number so buyers can reach you." };
    const phone = normalizeIndianMobile(raw);
    if (!phone) return { error: "Enter a valid 10-digit Indian mobile number." };
    out.phone = phone;
  }

  if (input.images !== undefined) {
    const raw = Array.isArray(input.images) ? input.images : [];
    if (raw.length > MAX_PHOTOS) return { error: `At most ${MAX_PHOTOS} photos.` };
    if (!raw.every(isOwnImagePath)) {
      return { error: "Photos must be uploaded through this site first." };
    }
    out.images = raw;
  }

  return { value: out };
}

export function parseNewListing(body: unknown): Parsed<NewListingInput> {
  const parsed = parseCore((body ?? {}) as Record<string, unknown>, false);
  if ("error" in parsed) return parsed;

  return {
    value: {
      ...(parsed.value as NewListingInput),
      subcategorySlug: parsed.value.subcategorySlug ?? null,
      location: parsed.value.location ?? null,
      images: parsed.value.images ?? [],
    },
  };
}

export function parseListingPatch(
  body: unknown,
): Parsed<Partial<NewListingInput>> {
  return parseCore((body ?? {}) as Record<string, unknown>, true);
}

/**
 * Confirms the category exists, and that the subcategory really belongs to it.
 *
 * Both are foreign keys, so a bad slug would be rejected by the database
 * anyway — but as a 500, not a message anyone can act on. The parent check is
 * not enforceable by a constraint at all: without it a listing could be filed
 * under Furniture / Smartphones.
 */
export async function checkCategory(
  categorySlug: string,
  subcategorySlug: string | null,
): Promise<string | null> {
  const { rows } = await query<{ slug: string; parent_slug: string | null }>(
    `SELECT slug, parent_slug FROM listing_categories WHERE slug = ANY($1::text[])`,
    [[categorySlug, subcategorySlug].filter(Boolean)],
  );

  const main = rows.find((row) => row.slug === categorySlug);
  if (!main) return "That category does not exist.";
  if (main.parent_slug !== null) return "Choose a main category, not a subcategory.";

  if (subcategorySlug) {
    const sub = rows.find((row) => row.slug === subcategorySlug);
    if (!sub) return "That subcategory does not exist.";
    if (sub.parent_slug !== categorySlug) {
      return "That subcategory belongs to a different category.";
    }
  }

  return null;
}
