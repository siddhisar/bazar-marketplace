import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Container from "../../components/layout/Container";
import { FiCheck, FiImage, FiPlus, FiX } from "react-icons/fi";
import {
  createListing,
  fetchCategories,
  fetchListing,
  imagePath,
  updateListing,
  uploadListingImages,
  MAX_LISTING_PHOTOS,
} from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../store/AuthContext";
import { useConfirm } from "../../store/ConfirmContext";
import { usePageGate } from "../../store/RouteGate";
import BackLink from "../../components/common/BackLink";
import Button from "../../components/common/Button";
import EmptyState from "../../components/common/EmptyState";
import { textFieldClassName } from "../../components/common/Input";
import { Select } from "../../components/common/Dropdown";

/** Matches the server's own cap, so the form refuses before uploading. */
const MAX_PHOTOS = MAX_LISTING_PHOTOS;

/** The conditions the `listing_condition` enum accepts, in the server's wording. */
const CONDITIONS = ["New with tags", "Like new", "Good", "Fair"] as const;
type Condition = (typeof CONDITIONS)[number];

/** Cities to offer. Free text is allowed too, so this is a convenience only. */
const CITY_NAMES = [
  "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Pune",
  "Chennai", "Kolkata", "Ahmedabad", "Jaipur",
];

/**
 * Mirrors the backend's own normalizeIndianMobile (listing.validator.ts) —
 * duplicated rather than shared, since the frontend and backend are separate
 * TS projects with no shared package between them. Kept in sync by hand; the
 * backend's copy is the one that actually decides what gets stored, this one
 * only gives the seller an inline error before a round trip would.
 */
function normalizeIndianMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * One photo in the form, from either of two sources:
 *   - `existing` — already on the listing, loaded from the server when
 *     editing. `path` is what gets sent back if it survives to submit.
 *   - `local` — just added from disk, previewed from an object URL, not
 *     uploaded until submit.
 * `id` is what removal and the grid's `key` operate on, regardless of which
 * kind a given photo is.
 */
type Photo =
  | { kind: "existing"; id: string; path: string; url: string }
  | { kind: "local"; id: string; name: string; url: string; file: File };

/**
 * The posting form — also the editing form, for an existing listing of the
 * signed-in user's own. `/post-ad` renders it with no id (create); the seller
 * dashboard's Edit action opens `/edit-listing/:id` (edit), which prefills
 * every field, including photos, from the listing already on the server.
 *
 * Photos added from disk are previewed locally from object URLs while the
 * form is filled in, then uploaded on submit — a half-written form must not
 * leave files on the server. A photo the listing already had needs no
 * upload; it rides along as the path the server already issued for it (see
 * `Photo` above). Submit is then: upload whatever is new, then send the
 * complete final photo list — kept and new interleaved in display order —
 * along with the rest of the fields.
 *
 * `seller_id` is never sent, on either create or edit. The server takes
 * ownership from the session on create, and refuses an edit whose session
 * does not own the listing (`requireListingOwner`) regardless of what this
 * form shows — this component's own ownership check below is only there to
 * avoid showing an editable form for a listing it is about to be refused for.
 *
 * Full submit flow (see `handleSubmit` below):
 *   1. uploadListingImages(files) -> POST /api/listings/images (multipart) for
 *      whichever photos are newly added -> upload.middleware.ts validates
 *      each file's real content, generates a thumbnail, stores both ->
 *      returns the `/images/...` paths.
 *   2. createListing(...) -> POST /api/listings, or updateListing(id, ...) ->
 *      PATCH /api/listings/:id, with the same body shape either way -> the
 *      new or updated listing comes back.
 *   3. This component shows a success screen with a link to the listing.
 */
function PostAd() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const { user } = useAuth();

  const { data: categories } = useApi(() => fetchCategories(), []);

  const {
    data: existingListing,
    loading: loadingListing,
    error: loadError,
  } = useApi(() => (id ? fetchListing(id) : Promise.resolve(null)), [id]);

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState<Condition | "">("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [postedId, setPostedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  // The success screen below replaces the form in place, at whatever scroll
  // position filling out a long form (plus this page's own usePageGate
  // loader) left the window at — nothing else on the page changes route or
  // otherwise triggers the app-wide ScrollToTop (App.tsx, keyed on pathname
  // only, which posting a listing never changes). Instant rather than
  // smooth, same as ScrollToTop itself, so the confirmation is the first
  // thing on screen rather than something scrolling into view a moment
  // later.
  useEffect(() => {
    if (postedId) window.scrollTo({ top: 0, behavior: "auto" });
  }, [postedId]);

  // Prefills the form once the listing to edit has loaded. Runs only when
  // `existingListing` itself changes (one successful load), not on every
  // render, so it never fights with the seller's own edits afterwards.
  useEffect(() => {
    if (!existingListing) return;
    setTitle(existingListing.title);
    setDescription(existingListing.description);
    setCategory(existingListing.category);
    setCondition(existingListing.condition as Condition);
    setPrice(String(existingListing.price));
    setQuantity(String(existingListing.quantity));
    setCity(existingListing.city);
    setArea(existingListing.location ?? "");
    setPhone(existingListing.seller.phone ?? "");
    setPhotos(
      existingListing.images.map((url) => ({
        kind: "existing" as const,
        id: url,
        path: imagePath(url),
        url,
      })),
    );
  }, [existingListing]);

  // Presentation only — see the comment on the component above. The real
  // enforcement is the server refusing the PATCH itself.
  const forbidden =
    isEdit && !!existingListing && !!user && existingListing.seller.sellerId !== user.id;

  /* A second, ref-backed lock alongside `submitting` — a ref updates
     instantly, with no render in between, where `submitting` (state) only
     takes effect on the next render. Two clicks close enough together could
     otherwise both read the *same* stale `submitting = false` and both slip
     past the guard below, uploading the same photos and creating the listing
     twice. The ref closes that window completely; `submitting` itself still
     drives everything the user actually sees (the button, the page loader). */
  const submittingRef = useRef(false);

  /* Takes over the whole viewport with the app's existing page loader — for
     the ~1-2s upload+create/update round trip, and (in edit mode) for the
     wait while the listing to prefill from is still loading — instead of
     only silently disabling the button. Same mechanism ListingDetails/
     SearchResults already use for their own first-load wait, so this reads
     as one consistent kind of "the app is doing something" rather than a
     new, one-off spinner. */
  usePageGate(submitting || (isEdit && loadingListing));

  /* Object URLs hold a reference to the file until revoked, so release them
     when the component goes away or the photos change. An `existing` photo's
     url came straight from the server, not from createObjectURL, so there is
     nothing of this component's to release for it. */
  useEffect(
    () => () => {
      for (const photo of photos) {
        if (photo.kind === "local") URL.revokeObjectURL(photo.url);
      }
    },
    [photos],
  );

  const addPhotos = (files: FileList | null) => {
    if (!files) return;

    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setError(`You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }

    const accepted = [...files]
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, room);

    if (accepted.length === 0) {
      setError("Those files are not images.");
      return;
    }

    setError(null);
    setPhotos((current) => [
      ...current,
      ...accepted.map((file) => ({
        kind: "local" as const,
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file,
      })),
    ]);
  };

  const removePhoto = (id: string) =>
    setPhotos((current) => current.filter((photo) => photo.id !== id));

  /**
   * Uploads the photos, then creates the listing with the paths returned.
   *
   * Two calls rather than one multipart submit: the upload endpoint already
   * exists and validates type, size and count on its own, and keeping listing
   * creation as plain JSON means the server never has to parse a file to find
   * out the title was blank. Only the newly-added ("local") photos are
   * uploaded — an existing one already has a path the server issued, and is
   * sent back as-is.
   */
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Checked and set together, synchronously, before anything `await`s —
    // see the comment on `submittingRef` above for why this (not `submitting`
    // state alone) is what actually closes the double-submit race.
    if (submittingRef.current) return;

    if (photos.length === 0) {
      setError("Add at least one photo — listings without photos rarely sell.");
      return;
    }
    // Title/description/price/area are still native inputs, so the browser's
    // own required-field check covers them before this ever runs. Category,
    // condition and city are Select's custom listbox, not a real form
    // control — it has nothing built in to enforce "required" with, so it's
    // checked by hand here instead.
    if (!category) {
      setError("Choose a category.");
      return;
    }
    if (!condition) {
      setError("Choose a condition.");
      return;
    }
    if (!city) {
      setError("Choose a city.");
      return;
    }
    const normalizedPhone = normalizeIndianMobile(phone);
    if (!normalizedPhone) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      setError("Enter how many are available (at least 1).");
      return;
    }

    submittingRef.current = true;
    try {
      /* Asked after validation, not before: there is no point confirming a
         form that is about to be rejected for a missing photo. */
      const ok = await confirm(
        isEdit
          ? {
              title: "Save these changes?",
              message: "The listing updates everywhere it appears — search, its category, and its own page.",
              confirmLabel: "Save changes",
            }
          : {
              title: "Post this listing?",
              message: "It will appear in search results straight away. You can edit or delete it afterwards from My Ads.",
              confirmLabel: "Post listing",
            },
      );
      if (!ok) return;

      setError(null);
      setSubmitting(true);

      const localPhotos = photos.filter((photo) => photo.kind === "local");
      const uploaded =
        localPhotos.length > 0
          ? await uploadListingImages(localPhotos.map((photo) => photo.file))
          : [];

      // Walked in display order (first = cover) rather than built from the
      // two groups separately, so an existing photo dragged/added-around
      // among new ones keeps its position — not just kept vs. new bucketed
      // apart.
      let nextUploaded = 0;
      const images = photos.map((photo) =>
        photo.kind === "existing" ? photo.path : uploaded[nextUploaded++].path,
      );

      const body = {
        title,
        description,
        category,
        condition,
        price: Number(price),
        quantity: parsedQuantity,
        city,
        location: area || undefined,
        images,
        phone: normalizedPhone,
      };

      const listing =
        isEdit && id ? await updateListing(id, body) : await createListing(body);

      // Set the moment the listing exists — the success screen below is
      // what "immediately after" means here, not a further delay for its
      // own sake once the server has actually confirmed the listing exists.
      setPostedId(listing.id);
    } catch (err) {
      // The server's wording is written to be read, so show it as-is. A 401
      // surfaces here too, which is what an expired session looks like.
      setError(
        err instanceof Error
          ? err.message
          : isEdit
            ? "Could not save the listing."
            : "Could not post the listing.",
      );
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const field = `mt-1.5 w-full ${textFieldClassName} px-3.5 py-2.5 text-sm text-charcoal-900`;
  const label = "text-xs font-semibold text-charcoal-500";

  if (postedId) {
    return (
      <Container className="py-16" narrow="md">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-6 py-16 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
            <FiCheck size={24} />
          </span>
          <h1 className="mt-5 text-xl font-black tracking-tight text-charcoal-900">
            {isEdit ? "Listing updated" : "Your listing is live"}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-charcoal-500">
            {isEdit
              ? "Your changes are saved and now show wherever this listing appears — search, its category, and its own page."
              : "It is saved and now appears in search, its category, and your ads. You can edit or remove it at any time."}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button to={`/listing/${postedId}`} variant="outline">
              View listing
            </Button>
            <Button to="/my-listings" variant="outline">
              Go to my ads
            </Button>
            {/* Editing is a one-off revision to something that already exists —
                there is no "edit another" in the way posting has "post another". */}
            {!isEdit && (
              <Button
                variant="outline"
                onClick={() => {
                  setPostedId(null);
                  setPhotos([]);
                  setTitle("");
                  setDescription("");
                  setCategory("");
                  setPrice("");
                  setQuantity("1");
                  setCondition("");
                  setCity("");
                  setArea("");
                  // Each listing keeps its own contact number, so a fresh
                  // post starts blank rather than reusing the last one.
                  setPhone("");
                }}
              >
                Post another
              </Button>
            )}
          </div>
        </div>
      </Container>
    );
  }

  if (isEdit && forbidden) {
    return (
      <Container className="py-16" narrow="md">
        <EmptyState
          as="h1"
          title="You can't edit this listing"
          description="Only the seller who posted a listing can make changes to it."
        >
          <Button to="/my-listings" variant="outline">Go to my ads</Button>
        </EmptyState>
      </Container>
    );
  }

  if (isEdit && loadError) {
    return (
      <Container className="py-16" narrow="md">
        <EmptyState
          as="h1"
          variant="error"
          title="Could not load this listing"
          description={loadError}
        >
          <Button to="/my-listings" variant="outline">Go to my ads</Button>
        </EmptyState>
      </Container>
    );
  }

  return (
    <Container className="py-8" narrow="md">
      <BackLink className="mb-4" />

      <h1 className="text-xl font-black tracking-tight text-charcoal-900 sm:text-2xl">
        {isEdit ? "Edit Listing" : "Post an Ad"}
      </h1>
      <p className="mt-1 text-sm text-charcoal-500">
        {isEdit
          ? "Update the details below — changes apply everywhere this listing appears."
          : "Add a few clear photos and an honest description — those two things sell an item faster than the price."}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        {/* Photos */}
        <fieldset className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5">
          <legend className="px-1 text-sm font-bold text-charcoal-900">
            Photos
          </legend>
          <p className="text-xs text-charcoal-500">
            Up to {MAX_PHOTOS}. The first one is used as the cover.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {photos.map((photo, index) => (
              <div
                key={photo.id}
                className="relative aspect-square overflow-hidden rounded-xl border border-cyan-500 bg-gradient-to-br from-cyan-50 to-mint-50"
              >
                <img
                  src={photo.url}
                  alt={photo.kind === "local" ? photo.name : "Listing photo"}
                  className="h-full w-full object-cover"
                />
                {index === 0 && (
                  <span className="absolute bottom-1 left-1 rounded bg-mist px-1.5 py-0.5 text-[9px] font-bold uppercase text-charcoal-900">
                    Cover
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  aria-label={photo.kind === "local" ? `Remove ${photo.name}` : "Remove photo"}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-r from-cyan-50/95 to-mint-50/95 text-charcoal-700 outline-none transition hover:scale-105 focus:ring-2 focus:ring-cyan-500/20"
                >
                  <FiX size={12} />
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                // Same border-cyan-500/focus-ring treatment as every text
                // field (Input.tsx's textFieldClassName) — dashed rather
                // than solid stays as the one difference, since that's what
                // marks this tile as an add slot rather than a filled photo,
                // not a different colour scheme from the rest of the form.
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-cyan-500 text-charcoal-500 outline-none transition hover:text-charcoal-900 focus:ring-2 focus:ring-cyan-500/20"
              >
                <FiImage size={20} />
                <span className="text-[11px] font-semibold">Add photo</span>
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              addPhotos(event.target.files);
              // Reset, so picking the same file twice still fires a change.
              event.target.value = "";
            }}
            className="hidden"
          />
        </fieldset>

        {/* Details */}
        <fieldset className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5">
          <legend className="px-1 text-sm font-bold text-charcoal-900">
            Item details
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className={label}>
                Title <span className="text-cyan-600">*</span>
              </span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={80}
                placeholder="e.g. iPhone 15 128GB"
                className={field}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className={label}>
                Description <span className="text-cyan-600">*</span>
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
                rows={5}
                maxLength={2000}
                placeholder="Condition, age, what is included, why you are selling…"
                className={`${field} resize-y`}
              />
            </label>

            <div className="block">
              <label htmlFor="post-ad-category" className={label}>
                Category <span className="text-cyan-600">*</span>
              </label>
              <Select
                id="post-ad-category"
                value={category}
                onChange={setCategory}
                required
                wrapperClassName="mt-1.5 w-full"
              >
                <option value="" hidden>Choose a category</option>
                {(categories ?? []).map((entry) => (
                  <option key={entry.slug} value={entry.slug}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="block">
              <label htmlFor="post-ad-condition" className={label}>
                Condition <span className="text-cyan-600">*</span>
              </label>
              <Select
                id="post-ad-condition"
                value={condition}
                onChange={(next) => setCondition(next as Condition)}
                required
                wrapperClassName="mt-1.5 w-full"
              >
                <option value="" hidden>Choose a condition</option>
                {CONDITIONS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            </div>

            <label className="block">
              <span className={label}>
                Price (₹) <span className="text-cyan-600">*</span>
              </span>
              <input
                type="number"
                min={0}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                required
                placeholder="0 for free or negotiable"
                className={field}
              />
            </label>

            <label className="block">
              <span className={label}>
                Quantity available <span className="text-cyan-600">*</span>
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
                placeholder="1"
                className={field}
              />
            </label>
          </div>
        </fieldset>

        {/* Location */}
        <fieldset className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5">
          <legend className="px-1 text-sm font-bold text-charcoal-900">
            Location
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="block">
              <label htmlFor="post-ad-city" className={label}>
                City <span className="text-cyan-600">*</span>
              </label>
              <Select
                id="post-ad-city"
                value={city}
                onChange={setCity}
                required
                wrapperClassName="mt-1.5 w-full"
              >
                <option value="" hidden>Choose a city</option>
                {CITY_NAMES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            </div>

            <label className="block">
              <span className={label}>
                Area <span className="text-cyan-600">*</span>
              </span>
              <input
                type="text"
                value={area}
                onChange={(event) => setArea(event.target.value)}
                required
                placeholder="e.g. Kothrud"
                className={field}
              />
            </label>
          </div>
        </fieldset>

        {/* Contact */}
        <fieldset className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5">
          <legend className="px-1 text-sm font-bold text-charcoal-900">
            Contact
          </legend>
          <p className="text-xs text-charcoal-500">
            Only shown to a buyer who taps "Contact Seller" on the listing —
            never on cards, search results, or the homepage.
          </p>

          <label className="mt-4 block sm:w-1/2">
            <span className={label}>
              Contact number <span className="text-cyan-600">*</span>
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
              maxLength={15}
              placeholder="e.g. 98765 43210"
              className={field}
            />
          </label>
        </fieldset>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
          >
            {error}
          </p>
        )}

        <Button type="submit" variant="outline" size="lg" fullWidth disabled={submitting}>
          <FiPlus size={16} />
          {submitting
            ? isEdit
              ? "Saving…"
              : "Posting…"
            : isEdit
              ? "Save changes"
              : "Post listing"}
        </Button>
      </form>
    </Container>
  );
}

export default PostAd;
