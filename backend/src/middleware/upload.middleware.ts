/**
 * Photo uploads for listings.
 *
 * Files are written straight to the folder the app already serves at
 * `config.imagesRoute`, so an uploaded photo is reachable at the same kind of
 * `/images/...` path as every seeded one and nothing downstream needs to know
 * where a given image came from.
 *
 * `multer` (imported below) is the library that reads a multipart/form-data
 * upload — the format a browser uses to send files, as opposed to plain JSON
 * — and turns each file into a buffer or a saved temp file that ordinary
 * Express code can work with. `uploadListingPhotos` further down is the
 * multer-configured middleware the listing-creation route runs before its
 * controller, so by the time that controller runs, `req.files` already holds
 * the uploaded photos.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import sharp from "sharp";
import { config } from "../config/env";

/** The brief allows eight photos per listing; the API is the thing enforcing it. */
export const MAX_PHOTOS_PER_LISTING = 8;

/** Per-file ceiling. Large enough for a phone photo, small enough to refuse a video. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Accepted types, and the extension each is stored with.
 *
 * Whitelisted by MIME type rather than by the name the client sent: the
 * extension is chosen here from the type, so "shell.php" cannot be uploaded and
 * later served as anything but an image.
 */
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

/** True when uploads belong in Supabase Storage rather than on local disk. */
const useSupabaseStorage = config.imageStorage === "supabase";

/**
 * Decoded formats sharp will accept as a genuine image of an allowed type —
 * the values `ALLOWED_TYPES` names, minus the `image/` prefix.
 */
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif"]);

/**
 * Confirms a file's *content*, not its name or its declared type.
 *
 * `fileFilter` above only ever sees what the client claims (`file.mimetype`
 * is the multipart part's declared Content-Type) — a renamed or relabelled
 * file sails through it unchanged. This decodes the actual bytes: `sharp`
 * only reports a format for data it can genuinely parse as that format, so
 * a non-image (or an image sharp cannot decode at all) throws here rather
 * than being resized, stored, and served as if it were a real photo.
 *
 * Runs as a side effect of the same `sharp` call already needed for the
 * thumbnail, not a separate pass over the bytes.
 *
 * @throws Error with a message fit to show the person who uploaded it.
 */
async function verifiedFormat(source: string | Buffer, originalName: string) {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(source).metadata();
  } catch {
    throw new Error(
      `"${originalName}" isn't a readable image — only JPEG, PNG, WebP and AVIF are accepted.`,
    );
  }

  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new Error(
      `"${originalName}" is a ${metadata.format ?? "file"}, not one of the accepted image types (JPEG, PNG, WebP, AVIF).`,
    );
  }
  return metadata;
}

/**
 * Random, never the client's filename: two people uploading "photo.jpg" must
 * not collide, and a caller must not get to choose a path on disk.
 */
const storedNameFor = (mimetype: string): string =>
  `${crypto.randomBytes(16).toString("hex")}${ALLOWED_TYPES[mimetype] ?? ".jpg"}`;

// Multer will not create the destination itself, and a fresh clone has no
// uploads folder until something is seeded into it. Only needed on disk.
if (!useSupabaseStorage) fs.mkdirSync(config.imagesDir, { recursive: true });

// In Supabase mode the bytes are held in memory just long enough to forward to
// Storage. A deployed backend's filesystem is ephemeral, so writing there would
// produce photos that vanish on the next restart.
const storage = useSupabaseStorage
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, done) => done(null, config.imagesDir),
      filename: (_req, file, done) => done(null, storedNameFor(file.mimetype)),
    });

export const uploadListingPhotos = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_PHOTOS_PER_LISTING },
  fileFilter: (_req, file, done) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      done(new Error("Only JPEG, PNG, WebP and AVIF images can be uploaded."));
      return;
    }
    done(null, true);
  },
}).array("photos", MAX_PHOTOS_PER_LISTING);

/** The public path a stored file is served from. */
export const publicPathFor = (filename: string): string =>
  `${config.imagesRoute}/${path.basename(filename)}`;

/** Result-page cards render far smaller than a full photo; no point shipping the original. */
const THUMBNAIL_WIDTH = 480;

/**
 * The thumbnail counterpart of any stored name or public path — same value,
 * `-thumb` inserted before the extension.
 *
 * Deterministic on purpose: nothing needs to look up or store a thumbnail's
 * path anywhere, including at listing-creation time — `thumbPathFor` on the
 * full-size path already stored in `listing_photos.path` is the thumbnail's
 * path too, computed the same way here and at read time
 * (`marketplace.repository.ts`, `listingSearch.sql.ts`,
 * `listingWrite.repository.ts` all `COALESCE(thumb_path, path)`).
 */
function withThumbSuffix(value: string): string {
  const ext = path.extname(value);
  return ext ? `${value.slice(0, -ext.length)}-thumb${ext}` : `${value}-thumb`;
}

/** The public path of a listing photo's thumbnail, given its full-size public path. */
export const thumbPathFor = (fullPath: string): string => withThumbSuffix(fullPath);

/**
 * Network-level failures worth retrying.
 *
 * A long-lived server keeps HTTPS connections to Storage alive between uploads,
 * and the far end is entitled to close an idle one at any point. Node only finds
 * out when it tries to use it, which surfaces as ECONNRESET on a request that
 * would have succeeded a moment earlier. Retrying gets a fresh socket.
 *
 * Deliberately only transport errors. An HTTP 4xx — wrong type, too large, bad
 * key — means the request itself is wrong and will fail identically on a retry,
 * so it is raised the first time.
 */
const RETRYABLE_CAUSES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const MAX_ATTEMPTS = 3;

/** The transport error code, which fetch buries under `cause`. */
function causeCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string } })?.cause;
  return cause?.code ?? (err as { code?: string })?.code;
}

/**
 * Uploads one object to Storage, retrying a dropped connection.
 *
 * @throws Error with a message fit to show a person. The central error handler
 *         passes `err.message` straight to the client, so a raw "fetch failed"
 *         here would end up on screen as the reason a listing could not be
 *         posted.
 */
async function putObject(file: Express.Multer.File, name: string): Promise<void> {
  let lastCode: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        `${config.supabaseUrl}/storage/v1/object/${config.storageBucket}/${name}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
            apikey: config.supabaseServiceRoleKey,
            "Content-Type": file.mimetype,
          },
          body: new Uint8Array(file.buffer),
        }
      );

      if (res.ok) return;

      // Not transient: report it as-is rather than trying twice more.
      const detail = (await res.text()).slice(0, 200);
      console.error(`[upload] storage rejected ${name}: ${res.status} ${detail}`);
      throw new Error(
        `The photo could not be saved (${res.status}). Please check the file and try again.`
      );
    } catch (err) {
      const code = causeCode(err);
      if (!code || !RETRYABLE_CAUSES.has(code)) throw err;

      lastCode = code;
      console.warn(
        `[upload] ${name} attempt ${attempt}/${MAX_ATTEMPTS} failed with ${code}${
          attempt < MAX_ATTEMPTS ? " — retrying" : ""
        }`
      );
      // Brief, growing pause: a reset socket is replaced immediately, but a
      // wobbling connection benefits from a moment before the next attempt.
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }

  throw new Error(
    `The photo could not be uploaded — the connection to storage kept dropping (${lastCode}). Please try again.`
  );
}

/**
 * Puts freshly uploaded files where they will still be readable later, and
 * returns the `/images/...` paths to store in `listing_photos.path`.
 *
 * On disk that is a no-op — multer has already written them. In Supabase mode
 * each buffer is PUT into the bucket first. Either way the caller gets the same
 * shape of path, so nothing downstream knows which backend is in use.
 *
 * A thumbnail is generated and stored alongside every original, at
 * `thumbPathFor(path)` — a listing card never needs the full-size photo, and
 * generating it once here is the only place that decision has to be made;
 * every read path (`marketplace.repository.ts`, `listingSearch.sql.ts`,
 * `listingWrite.repository.ts`) just prefers it when present and falls back
 * to the original otherwise, which is also what makes this safe to ship
 * without touching the ~145k already-seeded rows that have no thumbnail at
 * all (`thumb_path IS NULL` for every one of them, by design — see the
 * `COALESCE` at each read site).
 *
 * @throws Error if an upload or a thumbnail cannot be completed, so the
 *         request fails loudly rather than recording a row pointing at a
 *         file that does not exist, or one whose card silently falls back to
 *         the full-size image forever.
 */
export async function persistUploads(
  files: Express.Multer.File[]
): Promise<string[]> {
  if (!useSupabaseStorage) {
    await Promise.all(
      files.map(async (file) => {
        try {
          await verifiedFormat(file.path, file.originalname);
          await sharp(file.path)
            .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
            .toFile(path.join(config.imagesDir, withThumbSuffix(file.filename)));
        } catch (err) {
          // multer already wrote this one before the content check ran —
          // a rejected upload must not leave it sitting in the served
          // folder, reachable by anyone who guesses or finds its filename.
          // Awaited, not fire-and-forget: the caller must be able to trust
          // that the cleanup has actually happened by the time this rejects.
          await fs.promises.rm(file.path, { force: true });
          throw err;
        }
      })
    );
    return files.map((f) => publicPathFor(f.filename));
  }

  return Promise.all(
    files.map(async (file) => {
      await verifiedFormat(file.buffer, file.originalname);
      const name = storedNameFor(file.mimetype);
      const thumbnail = await sharp(file.buffer)
        .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
        .toBuffer();

      await Promise.all([
        putObject(file, name),
        putObject({ ...file, buffer: thumbnail }, withThumbSuffix(name)),
      ]);
      return publicPathFor(name);
    })
  );
}
