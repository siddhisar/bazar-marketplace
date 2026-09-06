# Bazaar — marketplace API (Express + PostgreSQL)

Backend for the classifieds marketplace: listings, full-text search with
relevance ranking and typo tolerance, combining filters with facet counts,
auth (email/password + Google OAuth), saved listings and saved searches, and
listing images. No ORM — SQL lives in `src/db/queries/*.sql.ts`.

## Prerequisites
- Node 20+
- PostgreSQL 15+ (local for development, or a hosted instance such as Supabase
  for deployment). The full-text search and query planner are used directly, so
  Postgres is not optional.

## Setup
```bash
cd backend
cp .env.example .env          # fill in DATABASE_URL (and Supabase keys if used)
npm install
npm run migrate               # applies src/db/marketplace.sql (idempotent)
npm run seed:marketplace100k  # 100,000 listings — see "Seed data" below
npm run dev                   # API on http://localhost:5000 (watch mode)
```

`DATABASE_URL` is read from the environment; there is no hardcoded fallback.
`.env` is git-ignored — no secrets are committed. See `.env.example` for every
variable and where to get it.

## Seed data (100,000+ listings)

The brief requires the deployed database to hold **at least 100,000 listings**,
because search behaviour at that volume is nothing like at two hundred rows.

```bash
npm run seed:marketplace100k          # 100,000 listings (default)
npm run seed:marketplace100k -- 5000  # a smaller set while developing
```

**What it creates** (a single run):

| Table            | Rows      |
|------------------|-----------|
| `listings`       | 100,000   |
| `listing_photos` | ~141,000  (1–3 per listing) |
| `users` (sellers)| 2,000     (`seller*@bazaar.test`, cannot log in) |

**How it works.** The catalogue is built by multiplying a committed fixture of
~150 real listing templates (`src/db/seeds/marketplaceTemplates.json` — each a
genuine product with its exact category, subcategory and working image paths)
across 2,000 sellers, 18 cities, and varied prices, dates, statuses and
conditions. Every row stays internally consistent (an iPhone listing keeps a
phone photo and a phone-shaped price) while differing in the fields search and
filtering range over. It is **not** the same listing inserted 100,000 times:
price, city, area, seller, age, status, view count and often condition all vary
per row. A seeded PRNG makes a given size reproducible, so `EXPLAIN ANALYZE`
comparisons stay meaningful between runs. The fixture is committed, so the seed
populates a **fresh** database without reading from any existing data.

Rows go in as batched multi-row `INSERT`s (≈3,300 listings / 15,000 photos per
statement, sized to the 65,535 bound-parameter limit), and `ANALYZE` runs at the
end so the planner has real statistics.

**Distribution** (measured on the deployed Supabase database after a full run):

- **Categories:** all 16 populated — Mobiles 9,528 · Electronics 8,916 ·
  Home & Kitchen 8,865 · Sports 8,309 · Men's Fashion 8,266 · Books 8,059 ·
  Women's Fashion 7,327 · Computers 5,401 · Furniture 5,289 · Bikes 4,837 ·
  Toys 4,796 · Accessories 4,769 · Music 4,124 · Pets 4,109 · Cameras 4,088 ·
  Cars 3,317
- **Subcategories:** 88 distinct · **Cities:** 15 · **Sellers:** 2,000 ·
  **Distinct prices:** 819
- **Price bands:** &lt;₹1k 21,543 · ₹1–5k 39,506 · ₹5–20k 18,772 ·
  ₹20–100k 11,588 · &gt;₹100k 8,591 (range ₹270 – ₹2,020,000)
- **Conditions:** Good 63,343 · Like new 22,245 · Fair 8,133 · New with tags 6,279
- **Status:** active 70,055 · expired 17,933 · sold 12,012
- **Dates:** posted across an 18-month window (Feb 2025 – Aug 2026)
- **Integrity:** 0 orphan photos, 0 invalid categories, 0 listings without a photo

A full run against the deployed database took **~144s** over the network and
left the database at **148 MB** (well under Supabase Free's 500 MB limit).

**How to verify the count:**
```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM listings;"
# 100000
psql "$DATABASE_URL" -c "SELECT count(*) FROM listing_photos;"
psql "$DATABASE_URL" -c "SELECT category_slug, count(*) FROM listings GROUP BY 1 ORDER BY 2 DESC;"
```
Or through the API (no login needed): `GET /api/listing-categories` returns each
category's live count.

## Search performance at 100k

Measured with `EXPLAIN (ANALYZE)` on the deployed database (execution time,
excluding client↔server network latency), all well under the 300 ms target:

| Query                                   | Execution time | Plan |
|-----------------------------------------|----------------|------|
| Full-text `iphone`, ranked, limit 12    | **63 ms**      | GIN bitmap scan on `search_vector` |
| Category browse (mobiles, newest, 12)   | **0.15 ms**    | index-only scan on `listings_status_category_posted_idx` |
| Facet counts (active, by category)      | **19 ms**      | — |

Reproduce with `npm run explain:facets`, or run `EXPLAIN (ANALYZE, BUFFERS)` on
the query in `src/db/queries/listingSearch.sql.ts`.

## Images
Listing images are stored outside the database. The DB keeps a logical path
(e.g. `/images/api/iphone-13-0.webp`); the backend serves `/images/*` either
from disk (`uploads/images`, local dev) or by redirecting to a Supabase Storage
bucket in production — controlled by `IMAGE_STORAGE`. See `.env.example`.

## Endpoints (summary)
Open (no account): `GET /health`, `/api/dashboard`, `/api/search/listings`,
`/api/search/suggest`, `/api/listings`, `/api/listings/:id`,
`/api/listing-categories`.
Session required: `/api/listings` (create), `/api/listings/:id` (edit/delete/
sold/renew — owner only), `/api/listings/images`, `/api/saved-listings*`,
`/api/saved-searches*`, and `/api/auth/*`. Responses use the envelope
`{ "success": true, "data": ... }` or `{ "success": false, "message": ... }`.

## Scripts
- `npm run dev` — start with hot reload (tsx watch)
- `npm start` — start once
- `npm run migrate` — apply `src/db/marketplace.sql` (idempotent)
- `npm run seed:marketplace100k` — seed 100,000 listings (see above)
- `npm run seed:marketplace` — seed the ~150 real templates only (no multiplication)
- `npm run explain:facets` — facet-query plans and timings
- `npm run typecheck` — TypeScript check, no emit
