/**
 * Maps a listing to the search term whose image pool it should draw from.
 *
 * Relevance is the whole point: a dog listing must get a dog photo, an iPhone an
 * iPhone photo. So the term is chosen from the most specific thing known about a
 * listing — a brand or product in the title first, then its subcategory. Only if
 * neither is recognised does it fall back to the main category.
 *
 * Shared by the fetch script (which pulls a small pool of Pexels photos per
 * distinct term) and the seed (which assigns each listing an image from its
 * term's pool). Keeping the mapping in one place means the images fetched and the
 * images assigned can never drift apart.
 */

/** A listing needs only these fields to be routed to an image pool. */
export type ImageRoutable = {
  title: string;
  subcategory_slug: string | null;
  category_slug: string;
};

/**
 * Title-keyword overrides, most specific first. These win over the subcategory
 * map, so "Used iPhone 13 Pro" gets an iPhone photo rather than a generic phone.
 * Order matters — the first regex that matches decides.
 */
const TITLE_OVERRIDES: [RegExp, string][] = [
  [/\biphone\b/i, "iphone"],
  [/\bsamsung\b/i, "samsung smartphone"],
  [/\bmacbook\b/i, "macbook laptop"],
  [/\bipad\b|galaxy tab/i, "tablet"],
  [/\bairpods\b|\bbeats\b|\bearphone/i, "wireless earbuds"],
  [/amazon echo|\becho\b|homepod/i, "smart speaker"],
  [/apple watch|\bsmartwatch\b/i, "smartwatch"],
  [/\brolex\b|longines|submariner|datejust/i, "luxury wristwatch"],
  [/\bdog\b/i, "dog"],
  [/\bcat\b/i, "cat"],
  // Checked before the generic aquarium line below: "Aquarium Air Pump" is
  // equipment, not the tank-of-fish photo that term would otherwise return.
  [/air pump/i, "aquarium air pump"],
  [/aquarium|fish tank/i, "aquarium fish tank"],
  [/\bsofa\b/i, "sofa"],
  [/dining table/i, "dining table"],
  [/\bwardrobe\b/i, "wardrobe closet"],
  [/bed frame|double bed/i, "bed frame"],
  [/refrigerator|\bfridge\b/i, "refrigerator"],
  [/washing machine/i, "washing machine appliance"],
  [/\bmicrowave\b/i, "microwave oven"],
  [/\bgrater\b/i, "cheese grater"],
  [/\bsaree\b/i, "saree"],
  [/\bkurti\b|kurta/i, "indian ethnic wear"],
  [/cricket bat/i, "cricket bat"],
  [/\bguitar\b/i, "acoustic guitar"],
  [/\btabla\b/i, "tabla drum"],
  [/motorcycle|kawasaki|motogp|sportbike/i, "motorcycle"],
  [/\bscooter\b/i, "scooter"],
  [/\bbicycle\b|hybrid bike/i, "bicycle"],
  [/nike|jordan|sneaker|trainers/i, "sneakers"],
  [/\bheel\b|heels/i, "high heel shoes"],
];

/**
 * Subcategory → search term. Keyed on the part after the "main--" prefix, since
 * that is the specific one. Every subcategory in the seed is listed, so a listing
 * never falls through to the coarse category map unless its subcategory is null.
 */
const SUBCATEGORY_TERMS: Record<string, string> = {
  // mobiles
  smartphones: "smartphone",
  "feature-phones": "mobile phone",
  tablets: "tablet",
  "smart-watches": "smartwatch",
  "mobile-accessories": "phone charger accessories",
  // electronics
  tvs: "television",
  refrigerators: "refrigerator",
  "washing-machines": "washing machine appliance",
  "air-conditioners": "air conditioner",
  speakers: "bluetooth speaker",
  headphones: "headphones",
  "kitchen-appliances": "kitchen appliance",
  // computers
  laptops: "laptop computer",
  monitors: "computer monitor",
  "keyboards-mouse": "computer keyboard",
  printers: "printer",
  // cars
  sedan: "sedan car",
  suv: "suv car",
  "other-cars": "car",
  hatchback: "hatchback car",
  "luxury-cars": "luxury car",
  // bikes
  motorcycles: "motorcycle",
  scooters: "scooter",
  bicycles: "bicycle",
  "bike-accessories": "motorcycle helmet",
  "electric-bikes": "electric scooter",
  // furniture
  "sofa-sets": "sofa",
  beds: "bed frame",
  wardrobes: "wardrobe closet",
  "study-tables": "study desk",
  "dining-sets": "dining table",
  "office-furniture": "office chair",
  storage: "wooden cabinet",
  // home & kitchen
  "kitchen-items": "kitchen utensils",
  cookware: "cookware pots pans",
  "home-decor": "home decor",
  lighting: "table lamp",
  organizers: "storage organizer",
  // men's fashion
  "mens-tshirts": "mens t-shirt",
  "mens-shirts": "mens shirt",
  "mens-jeans": "mens jeans",
  "mens-jackets": "mens jacket",
  "mens-ethnic": "indian ethnic wear",
  "mens-footwear": "mens sneakers",
  "mens-watches": "wristwatch",
  // women's fashion
  "womens-dresses": "womens dress",
  "womens-tops": "womens blouse top",
  "womens-jeans": "womens jeans",
  sarees: "saree",
  kurtis: "indian ethnic wear",
  "womens-ethnic": "indian ethnic wear",
  "womens-footwear": "high heel shoes",
  "womens-bags": "handbag",
  // books & stationery
  novels: "stack of books",
  "school-books": "textbooks",
  "college-textbooks": "textbooks",
  "exam-books": "textbooks",
  notebooks: "notebook",
  "art-supplies": "art supplies",
  stationery: "stationery",
  // sports
  cricket: "cricket bat",
  football: "soccer ball",
  badminton: "badminton racket",
  "gym-equipment": "dumbbells",
  cycling: "bicycle cycling",
  "yoga-fitness": "yoga mat",
  "sports-accessories": "sports equipment",
  // toys
  "kids-toys": "kids toys",
  "board-games": "board game",
  puzzles: "jigsaw puzzle",
  "gaming-accessories": "game controller",
  // music
  guitars: "acoustic guitar",
  keyboards: "piano keyboard",
  drums: "drum kit",
  tabla: "tabla drum",
  microphones: "microphone",
  "other-instruments": "ukulele",
  // cameras
  dslr: "dslr camera",
  lenses: "camera lens",
  tripods: "camera tripod",
  "camera-accessories": "camera",
  // pets
  "pet-accessories": "dog",
  "pet-beds": "dog bed",
  "pet-toys": "dog toys",
  aquariums: "aquarium fish tank",
  "pet-supplies": "pet supplies",
  // accessories
  bags: "backpack",
  watches: "wristwatch",
  sunglasses: "sunglasses",
  wallets: "leather wallet",
  jewellery: "jewellery earrings",
};

/** Coarse fallback if a listing has no subcategory and no title match. */
const CATEGORY_TERMS: Record<string, string> = {
  mobiles: "smartphone",
  electronics: "home electronics",
  computers: "laptop computer",
  cars: "car",
  bikes: "motorcycle",
  furniture: "furniture",
  "home-kitchen": "kitchenware",
  "mens-fashion": "mens clothing",
  "womens-fashion": "womens clothing",
  "books-stationery": "books",
  sports: "sports equipment",
  toys: "toys",
  music: "musical instrument",
  cameras: "camera",
  pets: "pet",
  accessories: "fashion accessories",
};

/**
 * The Pexels search term for a listing.
 *
 * @returns the most specific term available: a title match, else the
 *          subcategory's term, else the category's. Never empty.
 */
export function searchTermFor(listing: ImageRoutable): string {
  for (const [pattern, term] of TITLE_OVERRIDES) {
    if (pattern.test(listing.title)) return term;
  }

  const sub = listing.subcategory_slug?.split("--")[1];
  if (sub && SUBCATEGORY_TERMS[sub]) return SUBCATEGORY_TERMS[sub];

  return CATEGORY_TERMS[listing.category_slug] ?? listing.category_slug;
}

/** Every distinct term the seed can ask for, so the fetcher pulls them all. */
export function allSearchTerms(listings: ImageRoutable[]): string[] {
  return [...new Set(listings.map(searchTermFor))].sort();
}
