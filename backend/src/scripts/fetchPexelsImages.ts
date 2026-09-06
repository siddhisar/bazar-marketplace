/**
 * Fetches a small pool of relevant photos per search term from the Pexels API,
 * for the marketplace seed to draw listing images from.
 *
 * Run with:  npm run images:pexels
 *
 * Reads every distinct term the seed can ask for (derived from the committed
 * template fixture via imageSearchTerms.ts), queries Pexels for each, and writes
 * `src/db/seeds/pexelsImages.json` — a map of term -> array of image records.
 * The seed then assigns each listing an image from its own term's pool, so a
 * dog listing gets a dog photo and an iPhone gets an iPhone photo.
 *
 * Reuse is deliberate: a handful of photos per term is shared across the many
 * thousands of listings that share it. Relevance matters, uniqueness does not.
 *
 * Requires PEXELS_API_KEY in the environment. A free key is issued instantly at
 * https://www.pexels.com/api/. Pexels' free tier allows 200 requests/hour, and
 * this makes roughly one request per distinct term (~90), well within that.
 *
 * Pexels photos are free to use and hotlinkable; attribution is appreciated, so
 * each stored record keeps the photographer and the photo page URL.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { allSearchTerms, type ImageRoutable } from "../db/seeds/imageSearchTerms";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "../db/seeds/marketplaceTemplates.json");
const OUTPUT = path.join(__dirname, "../db/seeds/pexelsImages.json");

/** How many photos to keep per term. Enough to vary, few enough to stay curated. */
const PER_TERM = 24;

/** One stored photo: the URL to serve, plus attribution. */
type PexelsImage = {
  url: string;
  photographer: string;
  source: string;
};

type PexelsApiPhoto = {
  src: { large2x?: string; large?: string; medium?: string };
  photographer: string;
  url: string;
};

type PexelsApiResponse = { photos?: PexelsApiPhoto[] };

async function searchPexels(
  term: string,
  apiKey: string,
): Promise<PexelsImage[]> {
  const url =
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(term)}` +
    `&per_page=${PER_TERM}&orientation=landscape`;

  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    throw new Error(`Pexels ${res.status} for "${term}": ${await res.text()}`);
  }

  const body = (await res.json()) as PexelsApiResponse;
  const photos = body.photos ?? [];
  return photos.map((photo) => ({
    // large is ~940px wide — plenty for a card or a detail page, and lighter
    // than the originals. Fall back down the size ladder if large is absent.
    url: photo.src.large ?? photo.src.large2x ?? photo.src.medium ?? "",
    photographer: photo.photographer,
    source: photo.url,
  })).filter((image) => image.url !== "");
}

async function main(): Promise<void> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "PEXELS_API_KEY is not set. Get a free key at https://www.pexels.com/api/ " +
        "and add it to backend/.env",
    );
  }

  const templates = JSON.parse(
    fs.readFileSync(FIXTURE, "utf-8"),
  ) as ImageRoutable[];
  const terms = allSearchTerms(templates);
  console.log(`[pexels] ${terms.length} distinct terms to fetch…`);

  const pools: Record<string, PexelsImage[]> = {};
  const empty: string[] = [];

  for (const term of terms) {
    try {
      const images = await searchPexels(term, apiKey);
      pools[term] = images;
      if (images.length === 0) empty.push(term);
      console.log(`  ${term.padEnd(28)} ${images.length} images`);
    } catch (err) {
      empty.push(term);
      console.error(`  ${term.padEnd(28)} FAILED: ${(err as Error).message}`);
    }
    // Gentle pacing so a large run never trips the rate limit.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(pools, null, 2));
  console.log(`\n[pexels] wrote ${OUTPUT}`);
  console.log(
    `[pexels] ${Object.keys(pools).length} terms, ` +
      `${Object.values(pools).reduce((n, p) => n + p.length, 0)} images total`,
  );
  if (empty.length > 0) {
    console.warn(
      `[pexels] ${empty.length} terms returned no images: ${empty.join(", ")}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[pexels] failed:", err);
    process.exit(1);
  });
}
