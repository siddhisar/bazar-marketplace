/**
 * Small helpers that make the seeded listing data read like real second-hand
 * classifieds — without touching how search works.
 *
 * The search is a plain full-text match over a listing's own title and
 * description (see marketplace.sql). It does no synonym expansion: a search for
 * "laptop" matches listings whose words include "laptop", nothing more. The
 * reason a search for "laptop" used to miss real laptops is simply that their
 * titles said "MacBook Pro" or "Dell XPS" and never the word "laptop" — so this
 * adds the item type to the title where a real ad would carry it ("Dell XPS 13
 * Laptop"). That is a data change, visible in the title; the query is never
 * rewritten.
 *
 * `brandFor` populates the brand column so a search for a brand ("Apple",
 * "Dell") matches via that field, which the search vector already includes.
 */

/**
 * Brands recognised in a title, most specific first so "Apple Watch" and
 * "iPhone" both resolve to Apple. A listing with no recognised brand (a sofa, a
 * saree, a dog) gets null — no brand is invented.
 */
const BRAND_RULES: [RegExp, string][] = [
  [/iphone|ipad|ipod|macbook|airpods|apple watch|homepod|\bapple\b/i, "Apple"],
  [/samsung|galaxy/i, "Samsung"],
  [/\bdell\b/i, "Dell"],
  [/lenovo/i, "Lenovo"],
  [/asus|zenbook/i, "Asus"],
  [/huawei|matebook/i, "Huawei"],
  [/\boppo\b/i, "Oppo"],
  [/\bvivo\b/i, "Vivo"],
  [/realme/i, "Realme"],
  [/\bnike\b|air jordan/i, "Nike"],
  [/\bpuma\b/i, "Puma"],
  [/\badidas\b/i, "Adidas"],
  [/rolex/i, "Rolex"],
  [/longines/i, "Longines"],
  [/calvin klein/i, "Calvin Klein"],
  [/\bprada\b/i, "Prada"],
  [/\bmarni\b/i, "Marni"],
  [/\bknoll\b/i, "Knoll"],
  [/\blego\b/i, "LEGO"],
  [/\bxbox\b/i, "Xbox"],
  [/\bbeats\b/i, "Beats"],
  [/amazon echo|\becho\b/i, "Amazon"],
  [/yamaha/i, "Yamaha"],
  [/\bcasio\b/i, "Casio"],
  [/faber-castell/i, "Faber-Castell"],
  [/camlin/i, "Camlin"],
  [/heshe/i, "Heshe"],
  // Cars and two-wheelers — the second-hand catalogue's own brands.
  [/maruti( suzuki)?/i, "Maruti Suzuki"],
  [/hyundai/i, "Hyundai"],
  [/\bhonda\b/i, "Honda"],
  [/\btata\b/i, "Tata"],
  [/mahindra/i, "Mahindra"],
  [/toyota/i, "Toyota"],
  [/\bbmw\b/i, "BMW"],
  [/\baudi\b/i, "Audi"],
  [/mercedes(-benz)?/i, "Mercedes-Benz"],
  [/\bhero\b/i, "Hero"],
  [/bajaj/i, "Bajaj"],
  [/\btvs\b/i, "TVS"],
  [/royal enfield/i, "Royal Enfield"],
  [/\bather\b/i, "Ather"],
  [/\bola\b/i, "Ola"],
  // Everyday watch brands, so a search for one of these matches on brand too,
  // the same way "Rolex" already does.
  [/\btitan\b/i, "Titan"],
  [/fastrack/i, "Fastrack"],
  [/\btimex\b/i, "Timex"],
  [/\bsonata\b/i, "Sonata"],
  [/\bfossil\b/i, "Fossil"],
];

/** The brand named in a title, or null when there is no recognised brand. */
export function brandFor(rawTitle: string): string | null {
  for (const [pattern, brand] of BRAND_RULES) {
    if (pattern.test(rawTitle)) return brand;
  }
  return null;
}

/**
 * The item-type word a real ad would put in the title, per subcategory (keyed on
 * the part after "main--"). Only set where the model name would otherwise omit
 * it and a shopper might reasonably type it. Left out (null) where the title
 * already describes the item ("3-Seater Sofa", "Used Cricket Bat") or where no
 * single word fits (mixed accessories).
 */
export const ITEM_TYPE: Record<string, string> = {
  // mobiles
  smartphones: "Smartphone",
  "feature-phones": "Phone",
  tablets: "Tablet",
  "smart-watches": "Smartwatch",
  // electronics
  refrigerators: "Refrigerator",
  "washing-machines": "Washing Machine",
  "air-conditioners": "Air Conditioner",
  speakers: "Speaker",
  headphones: "Headphones",
  // computers
  laptops: "Laptop",
  monitors: "Monitor",
  printers: "Printer",
  // cars
  sedan: "Car",
  suv: "Car",
  "other-cars": "Car",
  hatchback: "Car",
  "luxury-cars": "Car",
  // bikes — "Bike" is the common word for a motorcycle in Indian classifieds,
  // and it is what a shopper types; a literal search then finds these.
  motorcycles: "Bike",
  scooters: "Scooter",
  bicycles: "Bicycle",
  "electric-bikes": "Scooter",
  // furniture
  "sofa-sets": "Sofa",
  beds: "Bed",
  wardrobes: "Wardrobe",
  "dining-sets": "Dining Table",
  lighting: "Lamp",
  // fashion
  "mens-tshirts": "T-Shirt",
  "mens-shirts": "Shirt",
  "mens-jeans": "Jeans",
  "mens-jackets": "Jacket",
  "mens-footwear": "Shoes",
  "mens-watches": "Watch",
  "womens-dresses": "Dress",
  "womens-jeans": "Jeans",
  "womens-footwear": "Shoes",
  "womens-bags": "Bag",
  sarees: "Saree",
  kurtis: "Kurti",
  // music
  guitars: "Guitar",
  keyboards: "Keyboard",
  // cameras
  dslr: "Camera",
  // accessories
  bags: "Bag",
  watches: "Watch",
  sunglasses: "Sunglasses",
  wallets: "Wallet",
};

/**
 * True when `title` already expresses `word`, case-insensitively — as its own
 * word ("Dell XPS 13 Laptop") or as part of a compound ("Prada Handbag"
 * already says "bag", "iPhone 6" already says "phone"). A stricter
 * whole-word check let those compounds slip through undetected and get the
 * type appended a second time ("Handbag Bag", "iPhone 6 32GB Phone") —
 * confirmed live against three templates before this was tightened to a
 * plain substring check.
 */
function containsWord(title: string, word: string): boolean {
  return title.toLowerCase().includes(word.toLowerCase());
}

/**
 * A realistic classified title that carries the item type.
 *
 * Returns the original title unchanged when it already names the item, or when
 * the subcategory has no natural type word. Otherwise the type is inserted where
 * a seller would write it — before the "— condition" tail if there is one, else
 * at the end: "Dell XPS 13 9300 — 2 Years Old" becomes "Dell XPS 13 9300 Laptop
 * — 2 Years Old". Nothing else about the title changes.
 */
export function realisticTitle(
  rawTitle: string,
  subcategorySlug: string | null,
): string {
  const sub = subcategorySlug?.split("--")[1];
  const type = sub ? ITEM_TYPE[sub] : undefined;
  if (!type || containsWord(rawTitle, type)) return rawTitle;

  const dash = rawTitle.indexOf(" — ");
  if (dash >= 0) {
    return `${rawTitle.slice(0, dash)} ${type}${rawTitle.slice(dash)}`;
  }
  return `${rawTitle} ${type}`;
}
