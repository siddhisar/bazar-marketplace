# Backend API Reference

This document describes the HTTP API exposed by `backend/` — an Express 5 +
TypeScript + PostgreSQL API for a classifieds marketplace. It is generated
from the actual route, controller, validator, and middleware source under
`backend/src`, not from any external spec.

## Base URL

The base URL is whatever the app is deployed at. In local development it is:

```
http://localhost:5000
```

(`config.port` in `backend/src/config/env.ts`, default `5000`, overridable
with the `PORT` env var.)

Every route documented below is mounted under `/api`, except the health
check, which is mounted at the server root. See `backend/src/app.ts`:

```ts
app.get("/health", ...);
app.use("/api/auth", authRouter);   // backend/src/routes/auth.routes.ts
app.use("/api", apiRouter);         // backend/src/routes/index.ts
```

## Response envelope

Every JSON response uses one of two shapes, produced by
`backend/src/utils/response.ts`:

Success (`sendSuccess`):

```json
{ "success": true, "data": { /* endpoint-specific payload */ } }
```

Error (`sendError`):

```json
{ "success": false, "message": "Human-readable reason" }
```

The status code passed to `sendSuccess` defaults to `200` but individual
endpoints use `201` for creation. Errors always carry the status code that
`sendError` was called with (400/401/403/404/409/500 depending on the
endpoint — see each section below).

The one exception to the envelope is `GET /health`, which hand-rolls
`{ "success": true, "status": "ok" }` (no `data` key) — see the Health
section.

Uncaught errors are caught by the central error handler
(`backend/src/middleware/error.middleware.ts`) and reported as
`500 { success: false, message: <err.message or "Internal server error"> }`.
Requests to routes that don't exist at all get
`404 { success: false, message: "Route not found: <METHOD> <path>" }`.

## Sessions / authentication

Auth is cookie-based, configured in `backend/src/middleware/session.middleware.ts`
using `express-session` with a PostgreSQL-backed store (`connect-pg-simple`,
table `user_sessions`):

- Cookie name: **`bazaar.sid`**
- `httpOnly: true`, `sameSite: "lax"`, `secure` is `true` only in production
- `maxAge`: 7 days, rolling (refreshed on each request)
- The session only stores `userId` (and a transient `oauthState` during the
  Google OAuth round trip) — there are no roles; "owner" is derived per
  request by comparing `listings.seller_id` to `req.session.userId`.

Clients must send the cookie on every request (`credentials: "include"` in
`fetch`, or equivalent) for any endpoint marked `requireAuth` below.

Two auth guards are used throughout, both defined in
`backend/src/middleware/auth.middleware.ts`:

- **`requireAuth`** — rejects any request with no `req.session.userId` by
  calling `sendError(res, 401, "Log in to continue.")` and stops the chain.
  It is a 401, not a 403, because the request hasn't been refused on its
  merits — it simply hasn't said who it is.
- **`requireListingOwner`** — runs after `requireAuth`, for routes with a
  listing `:id`. It looks up `listings.seller_id` for that id:
  - if `:id` isn't a plain integer, or no listing with that id exists →
    `404 { success: false, message: "Listing not found" }`
  - if the listing exists but `seller_id !== req.session.userId` →
    `403 { success: false, message: "That listing belongs to someone else." }`
  - otherwise, calls `next()`.
  A nonexistent listing is deliberately a 404 rather than a 403 — telling a
  stranger "that exists but isn't yours" would leak more than they need to
  know, and the two cases must look identical to someone probing ids.

---

## Health

### GET /health

**Auth:** open

Mounted directly on the app (not under `/api`), before the auth/API routers.

**Response 200:**
```json
{ "success": true, "status": "ok" }
```
Note this does **not** use the `{ success, data }` envelope — it's a
hand-written literal in `backend/src/app.ts`.

**Errors:** none.

---

## Dashboard

### GET /api/dashboard

**Auth:** open

Everything the homepage needs in one round trip: the total count of active
listings, the most recent listings, and every browsable category with its
live count. Backed by `getDashboard()` in
`backend/src/services/marketplace.service.ts`, which internally calls the
same code paths as `GET /api/listings` (10 most recent) and
`GET /api/listing-categories`, so the dashboard can never disagree with
those endpoints about what's on the site.

**Query params:** none.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "totalActive": 101903,
    "recent": [ /* ListingDTO, up to 10 items, newest first */ ],
    "categories": [ /* ListingCategoryDTO[] */ ]
  }
}
```

`ListingDTO` shape (from `backend/src/types/dto.ts`):
```json
{
  "id": "12345",
  "title": "Slim fit tee",
  "category": "mens-tops",
  "categoryLabel": "Tops",
  "audience": "Men",
  "brand": "Acme",
  "size": "M",
  "colour": "Blue",
  "condition": "Good",
  "price": 450,
  "city": "Pune",
  "location": null,
  "postedAt": "2026-08-10T12:00:00.000Z",
  "image": "/images/abc123.jpg"
}
```

`ListingCategoryDTO` shape:
```json
{ "slug": "mens-tops", "label": "Tops", "audience": "Men", "total": 812, "image": "/images/..." }
```

**Errors:** none beyond generic 500s.

---

## Search

### GET /api/search/listings

**Auth:** open

The main search/filter/sort endpoint, backed by `searchListings()` in
`backend/src/services/listingSearch.service.ts` and parsed by
`parseSearchRequest()` in `backend/src/validators/listingSearch.validator.ts`.
It runs a full-text (`tsquery`) search first; if a non-empty `q` is supplied
and the exact search returns nothing on page 1, it silently retries with
trigram similarity and marks the response `fuzzy: true`, including a
`suggestion` ("did you mean") string when one exists.

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string | — | Free-text query, trimmed and truncated to 120 chars. Empty/whitespace becomes `undefined`. |
| `category` | string | — | Category slug, passed through as-is (first value if repeated). |
| `audience` | string | — | Case-normalised (`men` → `Men`); must be one of `Men`, `Women`, `Unisex` or it's dropped entirely. |
| `city` | string | — | Passed through as-is. |
| `condition` | string or repeated | — | One of `New with tags`, `Like new`, `Good`, `Fair`. Accepts repeated `condition=` params or one comma-separated value; unknown values are silently filtered out; deduped; capped at 20 values. |
| `size` | string or repeated | — | Free-form (not restricted to an enum), same repeat/comma/length/count rules as `condition` (max 40 chars/value, max 20 values). |
| `colour` | string or repeated | — | Same rules as `size`. |
| `minPrice` | number | — | Must parse to a finite number ≥ 0, else dropped. |
| `maxPrice` | number | — | Same validation as `minPrice`. If `minPrice > maxPrice`, the two are silently swapped rather than rejected. |
| `postedWithin` | number (days) | — | Same numeric validation as `minPrice`. |
| `sort` | `relevance` \| `newest` \| `price_asc` \| `price_desc` | `newest` (or `relevance` if `q` is set) | Invalid/missing values fall back to the default; `relevance` only makes sense with a `q`. |
| `page` | integer | `1` | Must be a positive integer or it falls back to `1`. Clamped again server-side (see below). |
| `perPage` | integer | `24` | Must be a positive integer or falls back to `24`. Server clamps the effective value to the range 1–60 regardless of what's requested. |
| `cursor` | string (opaque) | — | A base64url-encoded token copied from a previous response's `nextCursor` or `prevCursor`. Only used when `cursorDir` is also supplied. |
| `cursorDir` | `next` \| `prev` | — | Direction to seek from `cursor`. Any other value is dropped, which disables cursor mode for that request. |

**Cursor pagination (keyset), explained:**

`cursor` and `cursorDir` are optional and independent of `page`/`perPage` —
supplying `page`/`perPage` alone still works exactly as a plain
offset-based jump to that page (e.g. deep-linking to page 5). But when a
request supplies both `cursor` (from a previous response's `nextCursor` or
`prevCursor`) and a matching `cursorDir`, the server decodes the cursor and,
if it's valid and carries the fields the current `sort` needs, seeks by
index (`WHERE (sort columns) > cursor-tuple`) instead of using `OFFSET`. This
keeps deep pagination fast — the query cost doesn't grow with how far into
the result set the page is, unlike `OFFSET` which has to skip every prior
row.

Notes on cursor behavior:
- A cursor that fails to decode (tampered, truncated, or left over from a
  different `sort` than the one now requested) is **not** an error — it's
  silently ignored and the request falls back to ordinary `page`/`offset`
  pagination.
- `cursorDir: "next"` walks forward (the next page); `"prev"` walks backward
  (the previous page).
- The response fields `nextCursor` / `prevCursor` are `null` when there is
  nothing further in that direction (e.g. `nextCursor` is `null` on the last
  page), so a client can simply disable the corresponding button rather than
  needing to detect an empty response.
- A cursor-based request that lands past the end of the result set is
  expected behavior (an already-disabled Next/Previous button prevents this
  in normal use) and is not "corrected" the way an out-of-range `page`
  number is (see below).
- If a plain `page` number is requested that's beyond the last real page
  (e.g. a filter has since narrowed the results), the server transparently
  re-fetches the last real page instead of returning an empty list over a
  nonzero `total`.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "items": [ /* ListingDTO[] */ ],
    "total": 101903,
    "page": 1,
    "perPage": 24,
    "hasMore": true,
    "sort": "newest",
    "fuzzy": false,
    "suggestion": null,
    "facets": {
      "category": [ { "value": "mens-tops", "label": "Tops", "count": 812 } ],
      "audience": [ /* FacetValueDTO[] */ ],
      "city": [ /* FacetValueDTO[] */ ],
      "condition": [ /* FacetValueDTO[] */ ],
      "size": [ /* FacetValueDTO[] */ ],
      "colour": [ /* FacetValueDTO[] */ ],
      "price": [ /* FacetValueDTO[], keyed by band id e.g. "5000-20000" */ ]
    },
    "nextCursor": "eyJwb3N0ZWRBdCI6Ii4uLiIsImlkIjoiMTIzIn0",
    "prevCursor": null
  }
}
```

**Errors:** none beyond generic 500s — invalid input degrades to a sane
default or is silently dropped rather than producing a 400. Specifically:
`sort`, `page`, `perPage`, `audience`, `condition`, `size`, `colour`,
`minPrice`, `maxPrice`, `postedWithin`, `cursor`, and `cursorDir` all fall
back to a default or are omitted on invalid input (see the table above);
none of them can trigger a 400.

### GET /api/search/suggest

**Auth:** open

Type-ahead suggestions for the search box, backed by `suggestSearches()` in
`backend/src/services/listingSearch.service.ts`. Deliberately answers an
empty list rather than an error for a too-short/empty query, since "not
enough typed yet" is a normal state while a user is still typing.

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string | `""` | No minimum length enforced by the validator itself (though the underlying query may return nothing for very short input). |
| `limit` | integer | service default | Must be a positive integer or it's left `undefined`, letting the repository's own default apply. |

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "title": "Slim fit tee", "price": 450, "category": "mens-tops", "categoryLabel": "Tops" }
  ]
}
```

**Errors:** none beyond generic 500s.

---

## Listings

### GET /api/listings

**Auth:** open

Browse active listings, optionally narrowed by category/audience, offset-paginated.

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `category` | string | — | Category slug; empty string is treated as "no filter". |
| `audience` | string | — | Case-normalised; must be `Men`, `Women`, or `Unisex` or it's dropped. |
| `page` | integer | `1` | Must be a positive integer, else falls back to `1`. |
| `perPage` | integer | `24` | Must be a positive integer, else falls back to `24`. Clamped server-side to 1–60. |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "items": [ /* ListingDTO[] */ ],
    "total": 101903,
    "page": 1,
    "perPage": 24,
    "hasMore": true
  }
}
```

**Errors:** none beyond generic 500s — invalid `page`/`perPage`/`audience` silently fall back to defaults.

### GET /api/listings/mine

**Auth:** `requireAuth`

The signed-in user's own listings, in any status (active, sold, expired) —
unlike the public feed, nothing here is filtered by status, since the point
of this endpoint is managing all of them.

Route ordering note: this is registered before `GET /api/listings/:id` in
`backend/src/routes/index.ts` specifically so `"mine"` isn't swallowed as an
`:id` value.

**Query params:** none.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "123",
      "title": "Slim fit tee",
      "description": "...",
      "category": "mens-tops",
      "categoryLabel": "Tops",
      "subcategory": null,
      "audience": "Men",
      "brand": "Acme",
      "size": "M",
      "colour": "Blue",
      "condition": "Good",
      "price": 450,
      "city": "Pune",
      "location": null,
      "postedAt": "2026-08-10T12:00:00.000Z",
      "expiresAt": "2026-09-24T12:00:00.000Z",
      "status": "active",
      "viewCount": 12,
      "image": "/images/abc123.jpg"
    }
  ]
}
```

**Errors:**
- `401` — no session (`requireAuth`).

### GET /api/listings/:id

**Auth:** open

A single listing's full detail page (description, all photos, seller info).
Sold/expired listings remain reachable by direct link — status is not
filtered here, only in the browse/search listings.

**URL params:**

| Param | Type | Notes |
|---|---|---|
| `id` | string (digits only) | Anything not matching `^\d+$` is treated as "not found" rather than reaching the database. |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "123",
    "title": "Slim fit tee",
    "category": "mens-tops",
    "categoryLabel": "Tops",
    "audience": "Men",
    "brand": "Acme",
    "size": "M",
    "colour": "Blue",
    "condition": "Good",
    "price": 450,
    "city": "Pune",
    "location": null,
    "postedAt": "2026-08-10T12:00:00.000Z",
    "image": "/images/abc123.jpg",
    "description": "...",
    "images": ["/images/abc123.jpg", "/images/def456.jpg"],
    "seller": {
      "name": "Jane Doe",
      "memberSince": "2024-01-05T00:00:00.000Z",
      "phoneMasked": "••••••89"
    },
    "viewCount": 12,
    "status": "active"
  }
}
```
The seller's phone number is never returned in full — only the masked form
(all but the last two digits replaced with `•`), or `null` if the seller has
none on file.

**Errors:**
- `404 { success: false, message: "Listing not found" }` — `id` isn't a
  plain integer, or no listing with that id exists.

### GET /api/listing-categories

**Auth:** open

Browsable top-level categories with live listing counts (subcategories are
excluded — they're fetched per-category elsewhere).

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `audience` | string | — | Case-normalised; must be `Men`, `Women`, or `Unisex`, else no filter is applied (all audiences returned). |

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "slug": "mens-tops", "label": "Tops", "audience": "Men", "total": 812, "image": "/images/..." }
  ]
}
```

**Errors:** none beyond generic 500s.

### POST /api/listings

**Auth:** `requireAuth`

Creates a new listing owned by the session's user. `seller_id` is always
taken from `req.session.userId` — it is never read from the request body,
so a caller cannot post a listing in someone else's name. Validated by
`parseNewListing()` in `backend/src/validators/listing.validator.ts`, then
`checkCategory()` confirms the category/subcategory pair is real.

**Body (JSON):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | yes | Trimmed; 3–120 chars. |
| `description` | string | yes | Trimmed; 10–4000 chars. |
| `category` | string | yes | Category slug; must exist and be a top-level category (`parent_slug IS NULL`) — checked against the DB. |
| `subcategory` | string | no | If provided, must exist and belong to `category` — checked against the DB. Empty string is treated as "none". |
| `condition` | string | yes | Must be one of `New with tags`, `Like new`, `Good`, `Fair`. |
| `price` | number | yes | Finite, ≥ 0, ≤ 100,000,000. Rounded to the nearest integer. |
| `city` | string | yes | Trimmed, non-empty. |
| `location` | string | no | Trimmed; empty string becomes `null`. |
| `images` | string[] | no | At most 8 entries. Each must match `/^\/images\/[A-Za-z0-9._/-]+$/` with no `..` — i.e. must be a path this server's own upload endpoint returned. Defaults to `[]`. |

Note: `seller_id` and `status` are never accepted from the body at all —
ownership comes from the session, and status only changes via the
sold/renew endpoints.

**Response 201:**
```json
{ "success": true, "data": { /* ListingDetailDTO — same shape as GET /api/listings/:id */ } }
```

**Errors:**
- `401` — no session.
- `400` — validation failure, e.g. `"Give the listing a title."`,
  `"That title is too long."`, `"Add a short description of the item."`,
  `"That description is too long."`, `"Choose a category."`,
  `"Choose a condition."`, `"Enter a valid price."`, `"That price is too
  high."`, `"Where is the item?"`, `"At most 8 photos."`, `"Photos must be
  uploaded through this site first."` (message is exactly whichever rule
  failed first).
- `400` — category validation failure: `"That category does not exist."`,
  `"Choose a main category, not a subcategory."`, `"That subcategory does
  not exist."`, `"That subcategory belongs to a different category."`

### PATCH /api/listings/:id

**Auth:** `requireAuth` + `requireListingOwner`

Partial update — every field is optional; omitted fields are left
unchanged (not nulled). Validated by `parseListingPatch()` (the same rules
as creation, but only applied to fields actually present in the body).

**URL params:**

| Param | Type | Notes |
|---|---|---|
| `id` | string (digits) | Resolved by `requireListingOwner` before the handler runs. |

**Body (JSON):** same fields and validation rules as `POST /api/listings`
(see above), but every field is optional. If `category` is present, its
pairing with `subcategory` is re-validated the same way as on create.

**Response 200:**
```json
{ "success": true, "data": { /* ListingDetailDTO, refreshed */ } }
```

**Errors:**
- `401` — no session.
- `403` — listing exists but belongs to someone else.
- `404` — `id` isn't numeric, or no such listing.
- `400` — a supplied field fails validation (same messages as create); or
  `"Nothing to update."` if the body contained no recognized fields at all.

### DELETE /api/listings/:id

**Auth:** `requireAuth` + `requireListingOwner`

Deletes the listing. Photos cascade via the DB foreign key.

**Response 200:**
```json
{ "success": true, "data": { "deleted": true } }
```
The delete is unconditional (no existence re-check inside the handler
itself — `requireListingOwner` already guarantees the row exists and is
owned by the caller before the handler runs).

**Errors:**
- `401` — no session.
- `403` — not the owner.
- `404` — no such listing.

### POST /api/listings/:id/sold

**Auth:** `requireAuth` + `requireListingOwner`

Marks the listing sold. Idempotent — marking an already-sold listing sold
again is not an error (the `sold_at` timestamp is only set the first time,
via `COALESCE`).

**Response 200:**
```json
{ "success": true, "data": { /* ListingDetailDTO, refreshed, status: "sold" */ } }
```

**Errors:**
- `401` — no session.
- `403` — not the owner.
- `404` — no such listing.

### POST /api/listings/:id/renew

**Auth:** `requireAuth` + `requireListingOwner`

Extends an active/expired listing for another full 45-day term (measured
from now, not from the old expiry). Refuses to renew a sold listing, since
that would quietly un-sell it.

**Response 200:**
```json
{ "success": true, "data": { /* ListingDetailDTO, refreshed, status: "active", expiresAt pushed forward */ } }
```

**Errors:**
- `401` — no session.
- `403` — not the owner.
- `404` — no such listing.
- `409 { success: false, message: "A sold listing cannot be renewed." }` —
  the listing's current status is `sold`.

---

## Listing Images

### POST /api/listings/images

**Auth:** `requireAuth`

Uploads one or more photos, independent of any listing — the Post Ad form
needs to show thumbnails before the listing itself is created, and a
half-filled form must not create a listing row. The paths this returns are
what a subsequent `POST /api/listings` or `PATCH /api/listings/:id` call
attaches via its `images` field.

Implemented with `multer` (`backend/src/middleware/upload.middleware.ts`).
In local dev, files are written to disk under `uploads/images` and served
back at `/images/<name>`; if `IMAGE_STORAGE=supabase` (or `SUPABASE_URL` is
set), files are instead uploaded to Supabase Storage and `/images/*`
redirects (302) to the bucket's public CDN URL — either way the API returns
the same `/images/...`-shaped path.

**Request:** `multipart/form-data`, field name **`photos`** (repeatable).

| Constraint | Value | Enforced by |
|---|---|---|
| Max files per request | **8** (`MAX_PHOTOS_PER_LISTING`) | multer's `limits.files` |
| Max size per file | **5 MB** (5 × 1024 × 1024 bytes) | multer's `limits.fileSize` |
| Allowed MIME types | `image/jpeg`, `image/png`, `image/webp`, `image/avif` | multer `fileFilter`, whitelisted by MIME type (not by client-supplied filename/extension) |
| At least one file | required | checked in the controller after multer runs |

Stored filenames are always server-generated random hex, never the
client's original filename, so two uploads named `photo.jpg` can't collide
and a caller can't choose a path on disk.

**Response 201:**
```json
{
  "success": true,
  "data": {
    "images": [ { "path": "/images/3f9a2b1c...c9.jpg" } ]
  }
}
```

**Errors:**
- `401` — no session.
- `400` — any multer failure is reported as a 400 with multer's own message,
  e.g. exceeding 8 files, exceeding 5 MB on a file, or an unsupported MIME
  type (`"Only JPEG, PNG, WebP and AVIF images can be uploaded."`).
- `400 { success: false, message: "Attach at least one photo." }` — request
  had no files after multer processed it.
- In Supabase storage mode, a persistent upstream failure (e.g. storage
  rejects the object, or the connection keeps dropping after 3 retries) is
  passed to the central error handler and surfaces as a `500` with a
  message describing the storage failure (see `putObject` in
  `upload.middleware.ts`) — not a 400, since it isn't the caller's mistake.

---

## Saved Listings

All saved-listings/saved-searches endpoints are behind `requireAuth` — they
are inherently per-user, so there is no anonymous form of any of them. Every
query is scoped to `req.session.userId`, which (together with the guard) is
the entire mechanism preventing one user from reading or modifying another
user's saved data.

### GET /api/saved-listings

**Auth:** `requireAuth`

Returns the ids the signed-in user has saved (not the listings themselves —
the frontend re-fetches those fresh so a saved item always reflects its
current price/status), newest-saved first.

**Response 200:**
```json
{ "success": true, "data": { "ids": ["123", "456"] } }
```

**Errors:**
- `401` — no session.

### POST /api/saved-listings

**Auth:** `requireAuth`

Saves a listing for the current user. Idempotent — saving an
already-saved listing succeeds silently (`ON CONFLICT DO NOTHING`).

**Body (JSON):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `listingId` | string or number | yes | Must consist of digits only once coerced to a string (`^\d+$`). |

**Response 201:**
```json
{ "success": true, "data": { "saved": true } }
```

**Errors:**
- `401` — no session.
- `400 { success: false, message: "A valid listingId is required." }` —
  `listingId` missing or not all-digits.
- `404 { success: false, message: "That listing does not exist." }` — the id
  is well-formed but there's no listing row for it (caught from a foreign
  key violation, not a 500).

### DELETE /api/saved-listings/:id

**Auth:** `requireAuth`

Unsaves a listing. A no-op (still 200) if it wasn't saved.

**URL params:**

| Param | Type | Notes |
|---|---|---|
| `id` | string (digits) | Must match `^\d+$`. |

**Response 200:**
```json
{ "success": true, "data": { "saved": false } }
```

**Errors:**
- `401` — no session.
- `400 { success: false, message: "A valid listing id is required." }` —
  `:id` isn't all-digits.

---

## Saved Searches

### GET /api/saved-searches

**Auth:** `requireAuth`

The signed-in user's saved searches, newest first.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "42",
      "name": "Cheap bikes in Pune",
      "query": "q=bike&city=Pune&maxPrice=5000",
      "seenCount": 3,
      "lastCheckedAt": "2026-08-10T12:00:00.000Z",
      "createdAt": "2026-08-01T09:00:00.000Z"
    }
  ]
}
```

**Errors:**
- `401` — no session.

### POST /api/saved-searches

**Auth:** `requireAuth`

Saves a search (name + serialized query string).

**Body (JSON):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Trimmed, non-empty. |
| `query` | string | no | Defaults to `""` if omitted or not a string. |
| `seenCount` | integer | no | Must be an integer ≥ 0, else defaults to `0`. This is the result total at save time, so the "new since" badge starts at zero rather than counting every existing listing as new — the client is expected to pass the count it already has from having just run the search. |

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "42",
    "name": "Cheap bikes in Pune",
    "query": "q=bike&city=Pune&maxPrice=5000",
    "seenCount": 0,
    "lastCheckedAt": "2026-08-16T10:00:00.000Z",
    "createdAt": "2026-08-16T10:00:00.000Z"
  }
}
```

**Errors:**
- `401` — no session.
- `400 { success: false, message: "A name is required to save a search." }`
  — `name` missing/blank after trimming.

### DELETE /api/saved-searches/:id

**Auth:** `requireAuth`

Deletes a saved search owned by the current user.

**URL params:**

| Param | Type | Notes |
|---|---|---|
| `id` | integer | Non-integer or ≤ 0 is treated the same as "not found". |

**Response 200:**
```json
{ "success": true, "data": { "deleted": true } }
```

**Errors:**
- `401` — no session.
- `404 { success: false, message: "Saved search not found." }` — `:id`
  isn't a positive integer, doesn't exist, or belongs to a different user.
  These three cases are deliberately indistinguishable in the response, so a
  probe can't learn whether a given id belongs to someone else.

### POST /api/saved-searches/:id/viewed

**Auth:** `requireAuth`

Marks a saved search as viewed — resets its "new results" badge by
stamping `last_viewed_at` and rebaselining `seen_count`.

**URL params:**

| Param | Type | Notes |
|---|---|---|
| `id` | integer | Same validation as the DELETE above. |

**Body (JSON):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `seenCount` | integer | no | Must be an integer ≥ 0, else treated as `0`. The new baseline for the "new since" count. |

**Response 200:**
```json
{ "success": true, "data": { "viewed": true } }
```

**Errors:**
- `401` — no session.
- `404 { success: false, message: "Saved search not found." }` — same
  "not found or not yours" conditions as the DELETE endpoint.

---

## Auth

All auth endpoints are mounted at `/api/auth` (`backend/src/routes/auth.routes.ts`).

### POST /api/auth/register

**Auth:** open

Creates a new account with a local password and immediately starts a
session for it (the session is regenerated first, so any pre-login session
id can't be reused afterwards — mitigates session fixation).

**Body (JSON):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Trimmed; 2–80 chars. |
| `email` | string | yes | Trimmed, lowercased; ≤254 chars; must match a permissive `local@domain.tld`-shaped pattern. |
| `password` | string | yes | 8–200 chars (`MIN_PASSWORD_LENGTH` = 8; bcrypt truncates past 72 bytes so longer inputs are rejected outright rather than silently truncated). |

**Response 201:**
```json
{ "success": true, "data": { "id": 1, "email": "jane@example.com", "name": "Jane Doe" } }
```
A `Set-Cookie: bazaar.sid=...` header is included, starting the session.

**Errors:**
- `400` — validation failure: `"Please enter your name."`, `"That name is
  too long."`, `"Please enter a valid email address."`, `"Password must be
  at least 8 characters."`, `"That password is too long."`
- `409 { success: false, message: "An account with that email already exists." }`
  — the email is already registered (detected via a unique constraint
  violation on insert, not a pre-check, so a race between two concurrent
  signups can't both succeed).

### POST /api/auth/login

**Auth:** open

**Body (JSON):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | string | yes | Trimmed, lowercased. |
| `password` | string | yes | — |

**Response 200:**
```json
{ "success": true, "data": { "id": 1, "email": "jane@example.com", "name": "Jane Doe" } }
```
Sets the session cookie.

**Errors:**
- `400 { success: false, message: "Please enter your email and password." }`
  — either field missing/empty.
- `400 { success: false, message: "Incorrect email or password." }` —
  email/password exceed the max lengths (254/200 chars) — treated as
  invalid credentials rather than a separate "too long" message.
- `401 { success: false, message: "Incorrect email or password." }` — email
  not found, wrong password, or the account has no local password (was
  created via Google only). All three produce the exact same message and
  (as close to) the same timing, specifically so this endpoint cannot be
  used to enumerate which email addresses have accounts.

### POST /api/auth/logout

**Auth:** open (safe to call with no session)

Destroys the session server-side (not just clearing the cookie), so a
copied/stolen cookie becomes useless immediately rather than only once it
expires.

**Response 200:**
```json
{ "success": true, "data": { "loggedOut": true } }
```
Clears the `bazaar.sid` cookie.

**Errors:** a session-store failure during destroy is passed to the central
error handler → generic `500`.

### GET /api/auth/me

**Auth:** open — this endpoint itself never 401s

Returns the currently signed-in user, or `null` if nobody is signed in.
`null` is a `200`, not a `401`, because "nobody is signed in" is the normal
state for the page-load check that calls this.

**Response 200 (signed in):**
```json
{ "success": true, "data": { "id": 1, "email": "jane@example.com", "name": "Jane Doe" } }
```

**Response 200 (not signed in, or the account was deleted after the session was issued):**
```json
{ "success": true, "data": null }
```

**Errors:** none beyond generic 500s.

### GET /api/auth/providers

**Auth:** open

Lets the frontend know whether Google sign-in is usable, so it can hide the
button rather than offering something that will fail.

**Response 200:**
```json
{ "success": true, "data": { "google": true } }
```
`google` is `true` only when both `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are configured.

**Errors:** none.

### GET /api/auth/google

**Auth:** open

**Not a JSON endpoint — a browser redirect.** Generates a CSRF `state`
value (stored in the session), then redirects (`302`) the browser to
Google's OAuth consent screen. Intended to be navigated to directly (e.g. by
setting `window.location`), not called via `fetch`.

**Query params:** none.

**Response:**
- `302` redirect to Google's authorization URL, if Google OAuth is
  configured.
- `503 { success: false, message: "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." }`
  — this one *is* JSON, returned directly (not a redirect) when the env vars
  aren't set.

### GET /api/auth/google/callback

**Auth:** open

**Not a JSON endpoint — a browser redirect target.** Google redirects the
user's browser here after they approve/deny consent. This handler always
responds with a redirect back to the frontend
(`config.clientUrl`, i.e. the first configured `CLIENT_URL` origin) — never
JSON, even on failure — so the SPA can read a `?auth=` query param and show
an appropriate message.

**Query params (set by Google, not the client):**

| Param | Notes |
|---|---|
| `code` | Authorization code to exchange for a profile. |
| `state` | Must match the value stashed in the session during `/google` (anti-CSRF). |
| `error` | Present if the user denied consent or Google reported an error. |

**Response:** always a `302` redirect to one of:
- `{clientUrl}/?auth=google_ok` — success; session cookie is set (session
  regenerated, same as register/login).
- `{clientUrl}/?auth=google_unconfigured` — Google OAuth not configured.
- `{clientUrl}/?auth=google_denied` — Google returned an `error` param (user declined).
- `{clientUrl}/?auth=google_state_mismatch` — missing/mismatched `state`, or
  no `code`.
- `{clientUrl}/?auth=google_failed` — the token exchange, profile fetch, or
  sign-in step threw (logged server-side; the browser only sees the generic
  reason code).

**Errors:** none surface as HTTP error statuses to the browser — every
failure mode is folded into a `302` redirect with a `reason` code, since the
caller here is a full-page navigation, not a script that could read a JSON
error body.

---

## Appendix: things this document deliberately does not claim

- **Rate limiting:** none. No rate-limiting middleware exists in the
  reviewed source (`backend/src/app.ts` and `backend/src/routes/*`), so
  there is no documented limit to state.
- **API versioning:** none — there is a single unversioned `/api` surface.
- **Pagination limits:** `perPage`/`limit` values are clamped server-side to
  a maximum of 60 items per page across `/api/listings` and
  `/api/search/listings` (see `listListings`/`searchListings` in the
  service layer), regardless of what the client requests.
