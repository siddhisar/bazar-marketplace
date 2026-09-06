/**
 * One-off migration: copies every file under `uploads/images` into the Supabase
 * Storage bucket that serves listing photos in production.
 *
 * The database move to Supabase left `listing_photos.path` pointing at values
 * like `/images/api/smartphones-123-0.webp`, which only resolve while the
 * backend runs on the machine holding `uploads/`. A deployed backend has no
 * such folder, so every listing image would 404. This uploads the files;
 * `rewritePhotoPaths.ts` then repoints the rows.
 *
 * Safe to re-run: uploads use upsert, so a partial run can simply be repeated.
 * Reads nothing from the database and deletes nothing from disk.
 *
 * Usage: npm run images:upload
 */
import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "listing-photos";

/** Local folder that `config.imagesDir` serves from today. */
const IMAGES_DIR = path.resolve(process.cwd(), "uploads", "images");

/** How many uploads to keep in flight. Kept modest to stay well inside
 *  Storage's rate limits — the whole set is only a few hundred files. */
const CONCURRENCY = 8;

const CONTENT_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

/** Every file under `dir`, returned as paths relative to `dir` with forward
 *  slashes, so they can be used directly as Storage object keys. */
async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Uploads one file, overwriting any existing object at the same key.
 *
 * @returns null on success, or a message describing the failure. Failures are
 *          collected rather than thrown so one bad file cannot abandon the run.
 */
async function upload(relPath: string): Promise<string | null> {
  const body = await readFile(path.join(IMAGES_DIR, relPath));
  const ext = path.extname(relPath).toLowerCase();
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${relPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY as string,
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        // Makes the run idempotent; without it a re-run 409s on every file.
        "x-upsert": "true",
      },
      body: new Uint8Array(body),
    }
  );
  if (!res.ok) return `${relPath}: HTTP ${res.status} ${await res.text()}`;
  return null;
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env"
    );
  }
  await stat(IMAGES_DIR); // fail loudly if the folder moved

  const files = await listFiles(IMAGES_DIR);
  console.log(`[upload] ${files.length} files found under ${IMAGES_DIR}`);

  const failures: string[] = [];
  let done = 0;

  // Fixed-size worker pool: each worker pulls the next index until exhausted.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < files.length) {
      const file = files[cursor++];
      const err = await upload(file);
      if (err) failures.push(err);
      if (++done % 50 === 0) console.log(`[upload] ${done}/${files.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`[upload] complete: ${done - failures.length} ok, ${failures.length} failed`);
  for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[upload] failed:", err);
  process.exit(1);
});
