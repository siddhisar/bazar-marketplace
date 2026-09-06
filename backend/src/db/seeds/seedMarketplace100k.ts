/**
 * Seeds the classifieds marketplace with 100,000+ realistic, browsable listings.
 *
 * Run with:  npm run seed:marketplace100k            (default 145000)
 *            npm run seed:marketplace100k -- 5000     (smaller set while developing)
 *
 * The brief requires 100,000+ listings, and about three in ten generated rows
 * are sold or expired (see the status roll below) — real states search already
 * excludes by design, not padding. So the row count this generates is scaled up
 * from 100,000 by that same ratio, which is what keeps the *active*, searchable
 * count — the number a shopper actually sees — at 100,000+ rather than the raw
 * table size. Everything is generated from a deterministic PRNG, so a given size
 * always produces the same catalogue and query-plan comparisons stay meaningful
 * between runs.
 *
 * The catalogue is built by multiplying a committed set of templates
 * (marketplaceTemplates.json — one per genuine product, with the exact category,
 * subcategory, condition and a realistic second-hand price that product should
 * carry) across many sellers, cities, prices, dates and conditions. That keeps
 * every generated row internally consistent — an iPhone listing stays in Mobiles
 * with a phone-shaped price, a used hatchback stays priced like a used hatchback
 * rather than a showroom one — while making each row distinct in the fields
 * search and filtering actually range over. It is emphatically not the same
 * listing inserted a hundred thousand times: price, city, area, seller, age,
 * status, view count and often condition all vary per row.
 *
 * Self-contained: the templates are a committed fixture, not read from the live
 * database, so this can populate a completely fresh database. Rows go in as
 * batched multi-row INSERTs to keep a run over the network to a hosted database
 * in the region of a couple of minutes rather than an hour, and ANALYZE runs at
 * the end so the planner has real statistics.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../../config/env";
import { connectDatabase, disconnectDatabase, query } from "../../config/database";
import { searchTermFor } from "./imageSearchTerms";
import { brandFor, realisticTitle } from "./productData";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SeedValue = string | number | boolean | null;

/* ~70% of rows land "active" (see the status roll below); 145,000 total keeps
   that active slice comfortably past the 100,000 requirement with headroom for
   the PRNG's natural spread, rather than landing right on the line. */
const DEFAULT_COUNT = 145_000;
const SELLER_COUNT = 2_000;

/** Postgres caps a statement at 65,535 bound parameters; batch under that. */
const MAX_PARAMS_PER_STATEMENT = 60_000;

/**
 * Mulberry32 — a small seeded PRNG. Math.random cannot be seeded, and an
 * unseeded catalogue would make before/after index timings incomparable.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20260818);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
const pickInt = (min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));

/**
 * A clearly fictional 10-digit Indian-mobile-shaped number for seller `i`
 * (0-based) — "98765 xxxxx", where xxxxx is that seller's own index. Sequential
 * and index-derived on purpose, not random: it means every seller's number is
 * different, no two collide, and the pattern itself signals "demo data" rather
 * than looking like a real, randomly-assigned number.
 */
function dummyPhone(i: number): string {
  return `98765 ${String(i % 100_000).padStart(5, "0")}`;
}

/** A real listing this catalogue is built from. */
type Template = {
  category_slug: string;
  subcategory_slug: string | null;
  audience: string;
  title: string;
  description: string;
  condition: string;
  price: number;
  brand: string | null;
  size: string | null;
  colour: string | null;
  photos: string[];
};

/** City with a representative area, so `location` is populated too. */
const CITIES: [string, string][] = [
  ["Mumbai", "Bandra"], ["Mumbai", "Andheri"], ["Delhi", "Saket"],
  ["Delhi", "Dwarka"], ["Bengaluru", "Koramangala"], ["Bengaluru", "Indiranagar"],
  ["Hyderabad", "Gachibowli"], ["Pune", "Kothrud"], ["Chennai", "Adyar"],
  ["Kolkata", "Salt Lake"], ["Ahmedabad", "Satellite"], ["Jaipur", "Vaishali Nagar"],
  ["Surat", "Adajan"], ["Lucknow", "Gomti Nagar"], ["Indore", "Vijay Nagar"],
  ["Nagpur", "Dharampeth"], ["Chandigarh", "Sector 17"], ["Kochi", "Kakkanad"],
];

const CONDITIONS = ["New with tags", "Like new", "Good", "Fair"] as const;

/**
 * A believable variation of a template price. Jitters ±25% and rounds to a step
 * that suits the magnitude — a car moves in thousands, a phone case in tens — so
 * the price facets get a real spread rather than the same handful of values.
 */
function jitterPrice(base: number): number {
  const varied = base * (0.75 + random() * 0.5);
  const step = varied >= 100_000 ? 5_000 : varied >= 10_000 ? 500 : varied >= 1_000 ? 50 : 10;
  return Math.max(step, Math.round(varied / step) * step);
}

/**
 * Loads rows in batches sized to stay under the bound-parameter limit. Values
 * stay parameterised: titles and descriptions contain apostrophes and em-dashes,
 * and concatenating them would both break and set a bad precedent.
 */
async function insertRows(
  table: string,
  columns: string[],
  rows: SeedValue[][],
): Promise<void> {
  if (rows.length === 0) return;
  const batchSize = Math.max(1, Math.floor(MAX_PARAMS_PER_STATEMENT / columns.length));

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const values: SeedValue[] = [];
      const tuples = batch.map((row) => {
        const placeholders = row.map((value) => {
          values.push(value);
          return `$${values.length}`;
        });
        return `(${placeholders.join(",")})`;
      });
      await client.query(
        `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${tuples.join(",")}`,
        values,
      );
    }
  } finally {
    await client.end();
  }
}

function loadTemplates(): Template[] {
  const file = path.join(__dirname, "marketplaceTemplates.json");
  const templates = JSON.parse(fs.readFileSync(file, "utf-8")) as Template[];
  if (templates.length === 0) throw new Error("[seed] no templates in fixture");
  return templates;
}

/** A curated Pexels photo: the URL to store, plus attribution. */
type PexelsImage = { url: string; photographer: string; source: string };

/**
 * The image pools keyed by search term, and a resolver from a listing to the
 * pool it should draw from.
 *
 * Images come from Pexels (fetched by `npm run images:pexels`), grouped so a
 * dog listing draws from dog photos and an iPhone from iPhone photos. Every pool
 * is reused across the many listings that share a term — relevance over
 * uniqueness, exactly as intended.
 */
function loadImagePools(): (listing: Template) => string[] {
  const file = path.join(__dirname, "pexelsImages.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "[seed] pexelsImages.json is missing. Run `npm run images:pexels` first " +
        "(needs PEXELS_API_KEY).",
    );
  }
  const pools = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
    string,
    PexelsImage[]
  >;

  const missing = new Set<string>();
  const urlsFor = (listing: Template): string[] => {
    const term = searchTermFor(listing);
    const images = pools[term];
    if (!images || images.length === 0) {
      missing.add(term);
      return [];
    }
    return images.map((image) => image.url);
  };
  // Attach so the caller can report gaps after generating.
  (urlsFor as { missingTerms?: Set<string> }).missingTerms = missing;
  return urlsFor;
}

async function seed(): Promise<void> {
  const requested = Number(process.argv[2] ?? DEFAULT_COUNT);
  const total = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_COUNT;

  const templates = loadTemplates();
  const imagesFor = loadImagePools();
  await connectDatabase(config.databaseUrl);
  const startedAt = Date.now();

  console.log(
    `[seed] generating ${total.toLocaleString()} listings from ${templates.length} templates…`,
  );

  /* Clear the listings and their photos, but keep the category taxonomy and any
     real user accounts. TRUNCATE ... CASCADE also clears saved_listings (which
     references listings); saved_searches reference only users, so they survive.
     RESTART IDENTITY resets listings.id to 1, which is what lets the photo rows
     below reference a listing by its loop index. */
  await query(
    "TRUNCATE TABLE listing_photos, listings RESTART IDENTITY CASCADE",
  );
  // Generated seller accounts only — a real signup must never be swept away.
  await query("DELETE FROM users WHERE email LIKE 'seller%@bazaar.test'");

  // --- sellers ------------------------------------------------------------
  // password_hash null: these exist to own listings, never to log in.
  //
  // `phone`/`contact_email` are separate, obviously-fake fields for the
  // "Contact Seller" action — never the sign-in `email` above, which must
  // never be shown to a buyer. Each seller gets a distinct value (not one
  // number/address copy-pasted across all 2,000), generated deterministically
  // from their index so a re-seed at the same size reproduces the same data.
  const sellerRows = Array.from({ length: SELLER_COUNT }, (_, i) => [
    `seller${i + 1}@bazaar.test`,
    null,
    `Seller ${i + 1}`,
    dummyPhone(i),
    `seller${String(i + 1).padStart(4, "0")}@example.com`,
  ]);
  await insertRows(
    "users",
    ["email", "password_hash", "display_name", "phone", "contact_email"],
    sellerRows,
  );

  // Read ids back rather than assuming a range: users.id is a SERIAL that is not
  // reset between runs (real accounts must keep their ids), so the generated
  // sellers sit at whatever range the sequence had reached.
  const { rows: sellerIdRows } = await query<{ id: number }>(
    "SELECT id FROM users WHERE email LIKE 'seller%@bazaar.test' ORDER BY id",
  );
  const sellerIds = sellerIdRows.map((row) => row.id);
  if (sellerIds.length === 0) throw new Error("[seed] no seller accounts inserted");
  console.log(`[seed] inserted ${sellerIds.length.toLocaleString()} sellers`);

  // --- listings + photos --------------------------------------------------
  const now = Date.now();
  const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;
  const SHELF_LIFE_MS = 45 * 24 * 60 * 60 * 1000;

  const listingColumns = [
    "seller_id", "title", "description", "category_slug", "subcategory_slug",
    "audience", "brand", "size", "colour", "condition", "price", "city",
    "location", "status", "view_count", "posted_at", "expires_at", "sold_at",
  ];
  const listingRows: SeedValue[][] = [];
  const photoRows: SeedValue[][] = [];

  for (let i = 1; i <= total; i++) {
    const template = pick(templates);
    const [city, area] = pick(CITIES);

    /* Condition mostly follows the template (a Rolex is not "new with tags"),
       but a fifth of rows are nudged so the condition facet is not a constant. */
    const condition = random() < 0.2 ? pick(CONDITIONS) : template.condition;

    /* Status first, then dates made consistent with it. Deriving status from a
       date spread instead left almost everything expired, which would shrink the
       searchable set and defeat seeding a hundred thousand. */
    const roll = random();
    const status = roll < 0.7 ? "active" : roll < 0.82 ? "sold" : "expired";

    let postedAt: Date;
    let soldAt: string | null = null;
    if (status === "active") {
      postedAt = new Date(now - Math.floor(random() * SHELF_LIFE_MS));
    } else if (status === "sold") {
      postedAt = new Date(now - Math.floor(random() * EIGHTEEN_MONTHS_MS));
      soldAt = new Date(
        postedAt.getTime() + Math.floor(random() * SHELF_LIFE_MS),
      ).toISOString();
    } else {
      postedAt = new Date(
        now - SHELF_LIFE_MS - Math.floor(random() * (EIGHTEEN_MONTHS_MS - SHELF_LIFE_MS)),
      );
    }
    /* A genuinely-active seed row is the marketplace's stable base catalogue,
       not a real seller's posting on its own 45-day clock — it must not
       organically expire and erode the active count on its own (confirmed
       live: 100% of a seed's active slice used to cross expires_at within
       45 days of seeding it, decaying the active count by ~2,600/day with
       nothing replacing it). A far-future date keeps it out of every sweep
       tick indefinitely; sold/expired rows keep the real 45-day window
       since their date only needs to look historically plausible, never to
       stay unexpired. */
    const expiresAt =
      status === "active"
        ? new Date(now + 5 * 365 * 24 * 60 * 60 * 1000)
        : new Date(postedAt.getTime() + SHELF_LIFE_MS);

    /* A realistic classified title that carries the item type ("Dell XPS 13
       Laptop"), and the brand populated from the name. Both are plain listing
       data the normal full-text search already reads — no query expansion. The
       full ad copy stays in `description`. */
    listingRows.push([
      pick(sellerIds),
      realisticTitle(template.title, template.subcategory_slug),
      template.description,
      template.category_slug,
      template.subcategory_slug,
      template.audience,
      brandFor(template.title) ?? template.brand,
      template.size,
      template.colour,
      condition,
      jitterPrice(template.price),
      city,
      area,
      status,
      pickInt(0, 900),
      postedAt.toISOString(),
      expiresAt.toISOString(),
      soldAt,
    ]);

    /* Photos come from this listing's Pexels pool — dog photos for a dog, iPhone
       photos for an iPhone. Take 1 to 3 distinct images, starting at a rotating
       offset so the thousands of listings that share a pool do not all show the
       same first photo. First one primary. A listing whose term has no images
       (reported at the end) simply gets none rather than a wrong one. */
    const pool = imagesFor(template);
    if (pool.length > 0) {
      const photoCount = Math.min(pool.length, pickInt(1, 3));
      const start = pickInt(0, pool.length - 1);
      for (let p = 0; p < photoCount; p++) {
        photoRows.push([i, pool[(start + p) % pool.length], p === 0, p]);
      }
    }
  }

  await insertRows("listings", listingColumns, listingRows);
  console.log(`[seed] inserted ${listingRows.length.toLocaleString()} listings`);

  await insertRows(
    "listing_photos",
    ["listing_id", "path", "is_primary", "position"],
    photoRows,
  );
  console.log(`[seed] inserted ${photoRows.length.toLocaleString()} photos`);

  const missing = (imagesFor as { missingTerms?: Set<string> }).missingTerms;
  if (missing && missing.size > 0) {
    console.warn(
      `[seed] no images for ${missing.size} term(s): ${[...missing].join(", ")}`,
    );
  }

  // The planner needs fresh statistics or it keeps choosing plans that suited an
  // almost-empty table.
  await query("ANALYZE listings");
  await query("ANALYZE listing_photos");

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[seed] done in ${seconds}s`);

  await disconnectDatabase();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed().catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
}
