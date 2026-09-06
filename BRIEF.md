# Bazaar — brief compliance checklist

**Source:** `Devnco-Project-Brief-05-Marketplace-Search (1).docx` — Project Brief 05, *Classifieds
Marketplace Search*. Working title Bazaar. 3–4 weeks, 1 developer, React + Node.

**How to use this file.** Check it before starting work and again before calling something done.
Every requirement below is quoted or closely paraphrased from the brief, with the section number so
it can be traced back. If a change does not advance something on this list, or actively conflicts
with §6, say so before building it.

Status key: ✅ done · 🟡 partial · ❌ not started · 🚫 built but out of scope

---

## 0. Hard constraints (§3)

| Area | Requirement | Status |
|---|---|---|
| Frontend | React SPA; build tool, styling, state management free choice | ✅ React 19 + Vite + Tailwind |
| Backend | Node.js, **separate** HTTP API (Express or similar) | ✅ Express 5, separate origin, deployed separately (Vercel + Render) |
| Database | **PostgreSQL** — not optional; uses its FTS and query planner | ✅ Postgres 17 (Supabase) |
| Search | Database's own full-text capability. **Elasticsearch / Algolia / Meilisearch not permitted** | ✅ `tsvector` + `pg_trgm` only |
| Auth | Email/password **plus OAuth 2.0** social login; secure sessions; hashed passwords | ✅ bcrypt cost 12 + Google OAuth, both verified end to end on the deployed instance |
| File storage | Listing photos **outside the database** — object storage or disk | ✅ Supabase Storage in production, disk in local dev |
| Repository | Single Git repo | ✅ |

> "The frontend and backend must be genuinely separate: React talks to a documented HTTP API."
> ✅ Both true now — every endpoint is documented in [`docs/API.md`](docs/API.md).

---

## 1. Where we actually are

The frontend and backend are joined and deployed: the frontend
(https://devnco-bazaar.vercel.app) calls the real API
(https://ojt-report-backend.onrender.com), which serves 100,000+ real
listings from Postgres. Every screen the brief describes exists and is wired
to a real endpoint: search with facets and URL state, listing details,
post-an-ad (with real photo upload and a real `POST /api/listings`), a
seller dashboard whose edit/mark-sold/delete/renew buttons hit real,
ownership-checked endpoints, saved searches and saved listings persisted
server-side, login/register, and Google OAuth.

> ⚠️ **Check before relying on any of this.** `main` in this repository can
> be ahead of what's actually deployed — Render and Vercel only reflect what
> has been pushed and redeployed. Run `git log origin/main -1` and compare
> to `git log -1` before a demo or submission; if they differ, push first.

Remaining gaps, in the order they're graded (§10):

0. **Unfiltered facet counts (no query, no filter — a plain "all listings"
   browse) measure ~400–550 ms at the current 145k-row scale**, over the
   300 ms target. Two real bugs behind part of this were found and fixed in
   a later pass (a missing covering index column on `listings_facets_idx`,
   and `work_mem` too low for the query's working set); what's left is an
   architectural cost from six sequential CTE scans that a safe, quick fix
   can't close. Every search that includes a term or a filter is fast
   (~15–20 ms) — see the root README's Performance section.
1. **Deep pagination beyond adjacent pages still costs `OFFSET`.** Fixed for
   the navigation that's actually used (Previous/Next, and any page number
   adjacent to the one on screen) via a keyset cursor — see the root
   [`README.md`](README.md#pagination) for the measured before/after. A
   hand-typed, non-adjacent `?page=500` still uses `OFFSET` for that one
   request, which is a documented, bounded trade-off (§9 Q1 in the README),
   not an oversight.
2. **Test coverage is real but not exhaustive** — the six cases the brief
   names explicitly all exist and pass (see the README's Tests section), but
   coverage of the write endpoints (create/edit/delete/sold/renew,
   ownership enforcement) is still by code review, not automated tests.

---

## 2. §4A — Accounts and access

> The buyer/seller account-type split mentioned in an earlier version of
> this document has been **fully reverted**. There is exactly one account
> type, matching the brief exactly: `/seller/login` redirects to `/login`,
> and the `account_type` column no longer exists (dropped in
> `backend/src/db/marketplace.sql`).

- ✅ Register with email + password, log in, log out — `backend/src/services/auth.service.ts`
- ✅ Passwords never stored or logged in plain text — bcrypt, `utils/password.ts`
- ✅ OAuth 2.0 social login (Google) — `services/google.service.ts`, implemented end to end
  (authorization-code flow, CSRF `state`, three-case email-matching logic) and **manually
  verified with a real Google sign-in against the deployed instance** — the session correctly
  persists and the UI reflects the logged-in state after redirect
- ✅ Social identity matching an existing email resolves to **one** user — three-case logic in
  `signInWithGoogle`, documented in the root README
- ✅ Browsing and searching require no account
- ✅ Posting a listing, saving a search, and the seller dashboard all require an account,
  enforced server-side (`requireAuth` on every write endpoint — see `docs/API.md`)
- ✅ "Only the seller who created a listing may edit or delete it, **enforced on the server for
  every endpoint**" — `requireListingOwner` middleware (`backend/src/middleware/auth.middleware.ts`),
  applied to every listing-mutating route: `PATCH`, `DELETE`, `/sold`, `/renew`

## 3. §4B — Listings

- ✅ Schema carries title, description, category, price, condition, city — `db/marketplace.sql`
- ✅ **Seller posts a listing** — `POST /api/listings`, ownership taken from the session, never the body
- ✅ **Image upload, up to 8 photos, one primary** — real `multer`-backed endpoint
  (`POST /api/listings/images`), server-side MIME/size/count validation (see `docs/API.md`)
- ✅ **Server-side validation of file type and size** — MIME-type whitelist (not filename
  extension), 5 MB/file, 8 files/request (`backend/src/middleware/upload.middleware.ts`)
- ✅ Edit / mark as sold / delete — real endpoints, ownership-checked, dashboard wired to them
  (`frontend/src/pages/MyListings/MyListings.tsx` refetches from the API rather than patching
  local state)
- ✅ Sold listing stays viewable by direct link but excluded from search — search filters to
  `status = 'active'`; `POST /api/listings/:id/sold` marks it
- ✅ Listings expire and drop out of search — a periodic sweep (`sweepExpiredListings`,
  `backend/src/server.ts`, every 5 minutes) flips `status` to `expired` once `expires_at` passes;
  a listing can also be renewed for another term (`POST /api/listings/:id/renew`)

## 4. §4C — Search (the core of the project)

- ✅ Single box matches titles **and** descriptions, ordered by relevance not date
- ✅ Title outranks description — `setweight` A/B/C/D in the generated `search_vector`
- ✅ Typo tolerance: "bycicle" → bicycles. `word_similarity` + `<%`, threshold lowered to 0.3, plus a
  "did you mean" suggestion, cost documented in the README (recall traded for precision; fuzzy
  only runs after an exact miss)
- ✅ Filters combine and each clears independently — `buildListingWhere`, unit-tested
- ✅ **Facet counts** — counts show beside every filter option, each group counted with its own
  filter excluded so alternatives stay switchable; correctness against a hand-known fixture is
  now a passing automated test (`backend/src/repositories/listingSearch.repository.test.ts`)
- ✅ Sorts: relevance, newest, price asc, price desc — all with a unique tiebreaker
- ✅ **Deep pagination: "page 500 must return as quickly as page 2"** — keyset cursor
  implemented for the navigation that's actually used; see the root README's Pagination section
  for the measured before/after and the one bounded exception (a hand-typed, non-adjacent page
  number still uses `OFFSET`)
- ✅ Search-as-you-type, debounced 250 ms — `components/search/SearchBar.tsx`, wired to a real
  `GET /api/search/suggest` endpoint
- ✅ Zero-result states offering a way forward — "did you mean" plus removable chips for each
  applied filter
- ✅ **The complete state of a search lives in the URL** — react-router-dom, every
  filter/sort/page/cursor written to the query string and read back out of it, round-trip tested
  (`frontend/src/lib/search.test.ts`)

## 5. §4D — Saved searches and seller tools

- ✅ `saved_searches` persisted server-side — `GET/POST/DELETE /api/saved-searches`,
  `POST /api/saved-searches/:id/viewed`, all behind `requireAuth` and scoped to the session's user
- ✅ Save a search under a chosen name, with a count of new matches since last viewed —
  `store/SavedSearchesContext.tsx`, `pages/SavedSearches/`, backed by the real endpoints above
- ✅ Seller dashboard with status, view count and expiry date — `pages/MyListings/`, tabbed by
  active / sold / expired, reading from `GET /api/listings/mine`

## 6. §5 — Non-functional requirements

- ✅ **Deployed database with ≥100,000 listings** — 145,000 live on Supabase (99,169 active),
  verified via a direct `count(*)` query and via `GET /api/listing-categories` on the deployed API
- 🟡 **Every search under 300 ms at that volume, measured on the deployed instance, numbers in
  the README** — true for every query that includes a search term or a filter (~14 ms full-text,
  ~0.1 ms category browse, ~15–20 ms filtered facets, ~0.1 ms keyset seek at any depth). **Not
  true for one specific case**: computing all six facet groups with no query or filter applied
  (a plain "all listings" browse) measures ~400–550 ms at the current row count — see the root
  README's Performance section for the root cause (found and partly fixed during this pass: a
  missing covering index column, and `work_mem` too low for the query's working set) and why the
  remaining gap needs a bigger rewrite than was safe to attempt this close to submission
- ✅ **`EXPLAIN ANALYZE` before/after indexes in the README, with each index justified** — root
  README's Indexes section plus the pagination before/after comparison; re-verified against the
  current 145k-row dataset, not just the original 100k seed
- ✅ **"All searching, filtering, sorting and counting happens in the database."** True of the
  live path end to end. (A pre-backend mock implementation still exists at
  `frontend/src/lib/search.ts` for historical reasons — nothing imports it; the live app uses
  `lib/searchApi.ts`, which calls the real API exclusively.)
- ✅ No N+1 on a results page — photos come from a `LATERAL` subquery, one round trip per page
- ✅ Every dynamically built filter value is parameterised — nothing user-supplied is
  concatenated, and this is now an automated test (SQL-injection-safety case)
- ✅ Every write endpoint validates input server-side — see `docs/API.md` for the exact 400
  conditions on every endpoint that accepts a body
- ✅ Meaningful status codes and machine-readable errors — consistent `{ success, data | error }`
  envelope across every endpoint, audited while writing `docs/API.md`. A gap found during a
  security re-audit is now fixed: the central error handler (`backend/src/middleware/error.middleware.ts`)
  used to send the raw `err.message` to the client in every environment, including production,
  which could leak an internal driver/constraint detail on an unexpected error — it now only does
  that outside production, and returns a generic message otherwise
- ✅ Code commented to the standard described (file-level purpose, exported function contracts,
  reasoning on non-obvious logic)
- 🟡 Usable at phone width — the topbar and major flows have been checked at mobile/tablet/desktop
  widths during this pass; a full page-by-page mobile audit hasn't been done
- 🟡 No secrets committed — real backend secrets have never been committed (`backend/.gitignore`
  excludes `.env`/`.env.*`); one historical exception is now documented rather than hidden: an
  early commit briefly included a `_to_delete/deploy.tgz` containing a `backend/.env` with
  placeholder scaffold values (not this project's real credentials), later removed from the tree
  but still present in git history. `frontend/.env` (a non-secret local default) was tracked in
  git and has now been untracked, with `.env`/`.env.*` added to `frontend/.gitignore`.

---

## 7. §6 — Explicitly out of scope

> "Do not build these, even if you have time."

| Forbidden | State |
|---|---|
| **Payments, checkout or escrow** | ✅ not built |
| Messaging between buyer and seller | ✅ not built |
| Map views / radius search | ✅ not built — city-level only |
| Recommendations or "similar listings" | ✅ not built |
| Moderation queues, reporting, admin tooling | ✅ not built |
| Real email or SMS delivery | ✅ not built |
| Seller ratings and reviews | ✅ not built |
| A mobile app | ✅ not built |

Nothing outside §4 exists in the frontend.

## 8. §7 — Deliverables

- ✅ Readable commit history, small meaningful commits
- ✅ **Deployed working URL** carrying all 100k listings, no login required to browse —
  https://devnco-bazaar.vercel.app
- ✅ **Unit tests**, the six named cases, passing from one documented command
  (`npm test` in each of `backend/` and `frontend/`) — see root README's Tests section for exactly
  which case is which
- ✅ **README**: what it does, local setup, env vars, seed script, architecture and data model,
  indexes and why, `EXPLAIN ANALYZE` before/after, deployed timings, how to run tests, decisions,
  known limitations — root [`README.md`](README.md), with `backend/README.md` covering seed-data
  mechanics in more depth
- ✅ **API documentation** — every endpoint: method, path, auth, query params, response shape,
  errors — [`docs/API.md`](docs/API.md)

## 9. §9 — Questions we must have a documented opinion on

All eight now answered in the root [`README.md`](README.md#9--questions-the-brief-asks-for-a-documented-opinion-on):

1. Offset pagination or a cursor — and what exactly breaks with the rejected one?
2. How do you compute every facet count without one query per option?
3. Should relevance outrank recency? What does someone searching "iphone" want first?
4. A listing is posted while a user reads page 3 — what should page 4 contain, and not contain?
5. Which indexes did you add, and which did you consider and reject?
6. What should a two-word query mean — all words, any word, or the exact phrase?
7. A user searches a word appearing in 60% of listings. What happens, and what should happen?
8. Where does price filtering belong — the same query as the text search, or a separate step? Why?

## 10. §10 — How this will be reviewed, in the brief's own order

1. **Measured search performance at 100k rows, on the deployed instance** — ✅ done, numbers in the README
2. Index design, and being able to explain every index — ✅ done
3. **Correctness of facet counts as filters combine** — ✅ done, and now an automated test
4. Pagination stability at depth, including while data changes underneath — ✅ done (keyset
   cursor + a passing test asserting a mid-walk insert doesn't shift an already-fetched page);
   the one remaining bounded exception is a hand-typed non-adjacent page number (§9 Q1)
5. Search quality on a vague query — ✅ done (typo tolerance, "did you mean")
6. Test quality, "particularly around counts and pagination rather than only the happy path" —
   ✅ done for the six named cases; write-endpoint test coverage is still by code review only
7. API design — resources, query parameters, status codes — ✅ documented in `docs/API.md`
8. Code readability and comments — ✅ maintained throughout
9. Documentation — a reviewer gets it running from the README alone — ✅ done
10. **Scope discipline** — ✅ nothing from §6 was built

Explicitly **not** assessed: visual flair, animation, choice of library.
