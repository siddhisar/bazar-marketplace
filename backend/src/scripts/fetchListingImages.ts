/**
 * Downloads real clothing photography from the DummyJSON product API into
 * uploads/images/api/ and writes a manifest describing what each file shows.
 *
 * Run with:  npm run images:fetch
 *
 * Why this exists: the seed previously drew from ~45 local files with no idea
 * what garment each depicted, so a dress listing could show a shirt. Each photo
 * here arrives tagged with the category it came from, which lets the seed match
 * a listing's category to a photo that actually shows that kind of garment.
 *
 * DummyJSON is used because it needs no API key. It is also small -- about a
 * hundred distinct apparel images -- so it cannot give a unique photo to every
 * one of a hundred thousand listings. See the note in the seed script.
 *
 * Safe to re-run: files already on disk are skipped, so this is not a way to
 * hammer the upstream API.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config/env";

const API = "https://dummyjson.com/products/category";
const OUTPUT_DIR = path.join(config.imagesDir, "api");
const MANIFEST = path.join(OUTPUT_DIR, "manifest.json");

/**
 * DummyJSON category -> the marketplace categories its photos suit.
 * A photo of a dress is only ever used for a dress listing.
 */
const SOURCES: { source: string; audience: Audience; categories: string[] }[] = [
  // Mobiles & tablets
  { source: "smartphones", audience: "Unisex", categories: ["mobiles"] },
  { source: "tablets", audience: "Unisex", categories: ["mobiles"] },
  // "mobile-accessories" is deliberately absent: it is cases and cables, so a
  // phone listing drawing from it showed a case rather than a handset. Photos
  // only ever come from a source that depicts the item itself.
  // Vehicles
  { source: "vehicle", audience: "Unisex", categories: ["cars"] },
  { source: "motorcycle", audience: "Unisex", categories: ["bikes"] },
  // Electronics
  { source: "laptops", audience: "Unisex", categories: ["electronics"] },
  // Home
  { source: "furniture", audience: "Unisex", categories: ["furniture"] },
  { source: "home-decoration", audience: "Unisex", categories: ["home-kitchen"] },
  { source: "kitchen-accessories", audience: "Unisex", categories: ["home-kitchen"] },
  // Sport
  { source: "sports-accessories", audience: "Unisex", categories: ["sports"] },
  // Accessories — watches, jewellery, eyewear, bags and phone add-ons
  { source: "mens-watches", audience: "Men", categories: ["accessories"] },
  { source: "womens-watches", audience: "Women", categories: ["accessories"] },
  { source: "womens-jewellery", audience: "Women", categories: ["accessories"] },
  { source: "sunglasses", audience: "Unisex", categories: ["accessories"] },
  { source: "mobile-accessories", audience: "Unisex", categories: ["accessories"] },
  // Fashion — one category among many now, not the whole catalogue
  { source: "mens-shirts", audience: "Men", categories: ["fashion"] },
  { source: "mens-shoes", audience: "Men", categories: ["fashion"] },
  { source: "womens-dresses", audience: "Women", categories: ["fashion"] },
  { source: "womens-shoes", audience: "Women", categories: ["fashion"] },
  { source: "womens-bags", audience: "Women", categories: ["fashion"] },
];

/**
 * Categories DummyJSON has no photography for.
 *
 * A job advert or a tutoring service has no product shot, and there is no
 * honest stock photo of "a plumber". Rather than borrow an unrelated image —
 * the exact fault this exercise exists to fix — each gets a generated, plainly
 * labelled card that never claims to be a photograph of the thing on offer.
 */
const PLACEHOLDER_CATEGORIES: { slug: string; label: string; tint: string }[] = [
  { slug: "cameras", label: "Cameras & Photography", tint: "#ec4899" },
  { slug: "books", label: "Books", tint: "#8b5cf6" },
  { slug: "stationery", label: "Stationery", tint: "#14b8a6" },
  { slug: "toys", label: "Toys & Games", tint: "#f97316" },
  { slug: "music", label: "Musical Instruments", tint: "#6366f1" },
  { slug: "pets", label: "Pets & Pet Supplies", tint: "#10b981" },
  { slug: "services", label: "Services", tint: "#f59e0b" },
];

export type Audience = "Men" | "Women" | "Unisex";

export type ImageManifestEntry = {
  /** Path as served by the API, e.g. "/images/api/smartphones-1-0.jpg". */
  file: string;
  source: string;
  audience: Audience;
  categories: string[];
  title: string;
};

/**
 * Writes one labelled SVG card and returns its manifest entry.
 *
 * SVG rather than a raster: no image library needed, a couple of kilobytes on
 * disk, and express.static already serves it with the right content type.
 */
function writePlaceholder(
  slug: string,
  label: string,
  tint: string,
  index: number,
): ImageManifestEntry {
  const fileName = `placeholder-${slug}-${index}.svg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img" aria-label="${label}">
  <rect width="800" height="600" fill="#f4f4f5"/>
  <rect x="0" y="0" width="800" height="8" fill="${tint}"/>
  <circle cx="400" cy="250" r="70" fill="${tint}" opacity="0.15"/>
  <text x="400" y="268" text-anchor="middle" font-family="system-ui,sans-serif" font-size="56" font-weight="700" fill="${tint}">${label.charAt(0)}</text>
  <text x="400" y="382" text-anchor="middle" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#18181b">${label}</text>
  <text x="400" y="422" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" fill="#71717a">No photo supplied</text>
</svg>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), svg, "utf-8");

  return {
    file: `${config.imagesRoute}/api/${fileName}`,
    source: `placeholder-${slug}`,
    audience: "Unisex",
    categories: [slug],
    title: label,
  };
}

type DummyProduct = { id: number; title: string; images: string[] };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Downloads one image unless it is already on disk. Returns false on failure. */
async function download(url: string, destination: string): Promise<boolean> {
  if (fs.existsSync(destination)) return true;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[images] skipped ${url} -> HTTP ${res.status}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    // Guard against a truncated or error-page response being written as a photo.
    if (buffer.byteLength < 1024) {
      console.warn(`[images] skipped ${url} -> only ${buffer.byteLength} bytes`);
      return false;
    }
    fs.writeFileSync(destination, buffer);
    return true;
  } catch (err) {
    console.warn(`[images] failed ${url}:`, (err as Error).message);
    return false;
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const manifest: ImageManifestEntry[] = [];
  let downloaded = 0;
  let reused = 0;

  for (const { source, audience, categories } of SOURCES) {
    const { products } = await fetchJson<{ products: DummyProduct[] }>(
      `${API}/${source}?limit=0&select=title,images`,
    );

    for (const product of products) {
      for (const [index, imageUrl] of product.images.entries()) {
        const extension = path.extname(new URL(imageUrl).pathname) || ".jpg";
        const fileName = `${source}-${product.id}-${index}${extension}`;
        const destination = path.join(OUTPUT_DIR, fileName);
        const existed = fs.existsSync(destination);

        if (await download(imageUrl, destination)) {
          if (existed) reused++;
          else downloaded++;
          manifest.push({
            file: `${config.imagesRoute}/api/${fileName}`,
            source,
            audience,
            categories,
            title: product.title,
          });
        }
      }
    }

    console.log(`[images] ${source}: ${products.length} products`);
  }

  // Categories with no upstream photography. Three variants each is enough for
  // neighbouring cards in a grid not to look copy-pasted.
  for (const { slug, label, tint } of PLACEHOLDER_CATEGORIES) {
    for (let index = 1; index <= 3; index++) {
      manifest.push(writePlaceholder(slug, label, tint, index));
    }
    console.log(`[images] ${slug}: 3 generated placeholders`);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  const unique = new Set(manifest.map((entry) => entry.file)).size;
  console.log(
    `[images] ${downloaded} downloaded, ${reused} already present, ${unique} distinct photos`,
  );
  console.log(`[images] manifest written to ${MANIFEST}`);
}

main().catch((err) => {
  console.error("[images] failed:", err);
  process.exit(1);
});
