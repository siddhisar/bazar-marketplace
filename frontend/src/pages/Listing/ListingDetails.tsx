import { Link, useParams } from "react-router-dom";
import Container from "../../components/layout/Container";
import {
  FiAlertTriangle,
  FiCalendar,
  FiEye,
  FiHeart,
  FiMapPin,
  FiTag,
} from "react-icons/fi";
import Breadcrumbs from "../../components/common/Breadcrumbs";
import EmptyState from "../../components/common/EmptyState";
import ListingDetailsSkeleton from "../../components/common/ListingDetailsSkeleton";
import ListingGallery from "../../components/listings/ListingGallery";
import MakeOfferCard from "../../components/listings/MakeOfferCard";
import SellerCard from "../../components/listings/SellerCard";
import ShareButton from "../../components/listings/ShareButton";
import { formatPrice, placeLabel, relativeTime } from "../../lib/format";
import { fetchListing } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { usePageGate } from "../../store/RouteGate";
import BackLink from "../../components/common/BackLink";
import Button from "../../components/common/Button";
import { useSavedListings } from "../../store/SavedListingsContext";

/**
 * One listing in full: photos, the facts, and how to reach the seller.
 *
 * There is no purchase flow. On a classifieds site the transaction happens
 * between two people offline, so the strongest action this page can offer is
 * "contact the seller".
 */
function ListingDetails() {
  const { id } = useParams<{ id: string }>();
  const { isSaved, toggle } = useSavedListings();

  /* Fetched by id rather than carried over from the grid: opening a listing
     from a link or a reload has no previous object to reuse, and the detail
     response holds fields the card never had (description, all photos, the
     seller, the view count). */
  const {
    data: listing,
    loading,
    error,
  } = useApi(() => fetchListing(id ?? ""), [id]);

  /* Opening a listing is a fresh page, so the branded loader holds until the
     listing itself is in. */
  usePageGate(loading && !listing);

  if (loading) {
    return (
      <Container className="py-8">
        <ListingDetailsSkeleton />
      </Container>
    );
  }

  if (error || !listing) {
    return (
      <Container className="py-16" narrow="md">
        <EmptyState
          as="h1"
          title="Listing not found"
          description="It may have been sold, expired, or the link is wrong."
        >
          <Button to="/search" variant="outline">Browse all listings</Button>
        </EmptyState>
      </Container>
    );
  }

  const saved = isSaved(listing.id);

  /* Sold and expired listings stay reachable by direct link (§4B) — but a
     visitor arriving at one has no other way to know it isn't actually
     available, so the same status badge the seller dashboard already uses
     shows up here too, on the one page a buyer would actually see it. */
  const statusBadge =
    listing.status === "sold"
      ? { label: "Sold", style: "bg-sand text-charcoal-600" }
      : listing.status === "expired"
        ? { label: "No longer available", style: "bg-amber-50 text-amber-700" }
        : null;

  const facts: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <FiTag size={14} />, label: "Condition", value: listing.condition },
    {
      icon: <FiMapPin size={14} />,
      label: "Location",
      value: placeLabel(listing.location, listing.city),
    },
    {
      icon: <FiCalendar size={14} />,
      label: "Posted",
      value: relativeTime(listing.postedAt),
    },
    {
      icon: <FiEye size={14} />,
      label: "Views",
      value: listing.viewCount.toLocaleString("en-IN"),
    },
  ];

  return (
    <Container className="py-8">
      <Breadcrumbs
        trail={[
          { label: "Home", to: "/home" },
          {
            label: listing.categoryLabel,
            to: `/search?category=${listing.category}`,
          },
          { label: listing.title },
        ]}
      />

      {/* Falls back to this listing's own category when opened from a shared
          link, which is nearer than the homepage to where "results" implies. */}
      <BackLink
        label="Back to results"
        fallbackTo={`/search?category=${listing.category}`}
        className="mb-6 mt-4"
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
        {/* Left: photos, then the detail */}
        <div className="min-w-0">
          <ListingGallery images={listing.images} alt={listing.title} />

          <div className="mt-8">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 className="text-xl font-black leading-snug tracking-tight text-charcoal-900 sm:text-2xl">
                {listing.title}
              </h1>
              {statusBadge && (
                <span
                  className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusBadge.style}`}
                >
                  {statusBadge.label}
                </span>
              )}
            </div>
            <p className="mt-2 text-2xl font-black tracking-tight text-charcoal-900">
              {formatPrice(listing.price)}
            </p>
            {listing.status === "active" && (
              <p className="mt-1 text-sm font-bold text-emerald-700">
                {listing.quantity.toLocaleString("en-IN")} available
              </p>
            )}

            <Link
              to={`/category/${listing.category}`}
              className="mt-3 inline-flex rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-100"
            >
              {listing.categoryLabel}
            </Link>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5 sm:grid-cols-4">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="flex items-center gap-1.5 text-xs text-charcoal-400">
                  {fact.icon}
                  {fact.label}
                </dt>
                <dd className="mt-1 text-sm font-bold text-charcoal-900">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <section className="mt-8">
            <h2 className="text-sm font-black uppercase tracking-wide text-charcoal-900">
              Description
            </h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-charcoal-600">
              {listing.description}
            </p>
          </section>

          <section className="mt-8 flex items-start gap-3 rounded-2xl border border-taupe p-5">
            <FiAlertTriangle
              size={18}
              className="mt-0.5 flex-shrink-0 text-amber-600"
            />
            <div>
              <h2 className="text-sm font-bold text-charcoal-900">Stay safe</h2>
              <ul className="mt-2 space-y-1 text-sm leading-relaxed text-charcoal-600">
                <li>Meet the seller in a public place.</li>
                <li>Check the item thoroughly before paying.</li>
                <li>Never pay a deposit or advance before seeing the item.</li>
              </ul>
            </div>
          </section>
        </div>

        {/* Right: the actions, kept in view while the detail is read */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <SellerCard seller={listing.seller} available={listing.status === "active"} />

          <MakeOfferCard
            listingId={listing.id}
            listingPrice={listing.price}
            sellerId={listing.seller.sellerId}
            available={listing.status === "active"}
          />

          <div className="mt-4 flex gap-2">
            {/* A toggle, not a one-shot action — "saved" is a state that
                persists, not a moment of being pressed — so this keeps its
                own two-state look rather than Button's `outline` variant
                (whose filled look is only ever transient, for the instant of
                a click). The border stays the same blue either way; only the
                fill reflects whether it's actually saved, and nothing
                recolours on hover, same rule as every other button. */}
            <button
              type="button"
              onClick={() => toggle(listing.id)}
              aria-pressed={saved}
              className={`flex flex-1 items-center justify-center gap-2 rounded-full border border-cyan-500 py-3 text-sm font-bold text-charcoal-900 transition ${
                saved ? "bg-mist" : ""
              }`}
            >
              <FiHeart size={15} fill={saved ? "currentColor" : "none"} />
              {saved ? "Saved" : "Save listing"}
            </button>

            <ShareButton
              title={listing.title}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-cyan-500 py-3 text-sm font-bold text-charcoal-900 transition"
            />
          </div>
        </aside>
      </div>
    </Container>
  );
}

export default ListingDetails;
