/**
 * Shape contracts and reference data still used after the migration to the
 * real API.
 *
 * This used to also hold a full fixture — generated mock listings the search
 * page filtered in the browser before the real backend existed. That
 * machinery (SEED_ROWS, buildListing, LISTINGS, MY_LISTINGS,
 * placeholderImage, and display helpers duplicated in lib/format.ts) has been
 * removed: nothing outside this file imported any of it once the last
 * consumer moved to `/api/*`. What remains is either a type other modules
 * still reference (`Listing`, via lib/search.ts) or reference data with no
 * server-side equivalent of its own (`CATEGORIES`, `CITY_NAMES`).
 */

export type Condition = "New" | "Like New" | "Good" | "Fair";

export type ListingStatus = "active" | "sold" | "expired";

export type Seller = {
  name: string;
  memberSince: string;
  /** Deliberately partial — the full number appears only after "Contact". */
  phoneMasked: string;
};

export type Listing = {
  id: string;
  title: string;
  description: string;
  price: number;
  /** Category slug, e.g. "mobiles". */
  category: string;
  /** Human label for that slug, e.g. "Mobiles". */
  categoryLabel: string;
  condition: Condition;
  /** Neighbourhood or area. */
  location: string;
  city: string;
  /** Cover photo. */
  image: string;
  images: string[];
  seller: Seller;
  /** ISO timestamp. */
  postedAt: string;
  views: number;
  status: ListingStatus;
};

export type Category = {
  slug: string;
  label: string;
};

/**
 * The marketplace's categories.
 *
 * Slugs and labels must match `listing_categories` in the database exactly: the
 * components still reading this array (header menu, footer, Post Ad dropdown)
 * link to `/search?category=<slug>`, and a slug with no server-side counterpart
 * renders an empty results page.
 *
 * This is the last hardcoded copy. Everything already migrated reads the same
 * list from /api/listing-categories, and this goes with the rest of the fixture
 * once those components follow.
 */
export const CATEGORIES: Category[] = [
  { slug: "mobiles", label: "Mobiles" },
  { slug: "electronics", label: "Electronics & Appliances" },
  { slug: "computers", label: "Computers & Laptops" },
  { slug: "cars", label: "Cars" },
  { slug: "bikes", label: "Bikes" },
  { slug: "furniture", label: "Furniture" },
  { slug: "home-kitchen", label: "Home & Kitchen" },
  { slug: "mens-fashion", label: "Men's Fashion" },
  { slug: "womens-fashion", label: "Women's Fashion" },
  { slug: "books-stationery", label: "Books & Stationery" },
  { slug: "sports", label: "Sports & Fitness" },
  { slug: "toys", label: "Toys & Games" },
  { slug: "music", label: "Musical Instruments" },
  { slug: "cameras", label: "Cameras & Photography" },
  { slug: "pets", label: "Pets & Pet Supplies" },
  { slug: "accessories", label: "Accessories" },
];

/** Cities offered wherever a city needs picking from a list (e.g. Post Ad). */
export const CITY_NAMES = [
  "Pune",
  "Mumbai",
  "Bengaluru",
  "Delhi",
  "Hyderabad",
  "Chennai",
  "Ahmedabad",
  "Jaipur",
];
