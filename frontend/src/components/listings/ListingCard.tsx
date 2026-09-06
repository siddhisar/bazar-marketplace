import { Link } from "react-router-dom";
import { FiHeart, FiMapPin } from "react-icons/fi";
import { formatPrice, placeLabel, relativeTime } from "../../lib/format";
import type { ListingCardData } from "../../lib/api";
import { useSavedListings } from "../../store/SavedListingsContext";
import ImageWithLoader from "../common/ImageWithLoader";

type ListingCardProps = {
  listing: ListingCardData;
};

/**
 * Condition badge tint, soft-background style rather than a solid fill so a
 * grid of these reads as labelled rather than as a wall of colour chips.
 * Unrecognised values (there shouldn't be any) fall back to a neutral pill.
 */
const CONDITION_STYLE: Record<string, string> = {
  "New with tags": "bg-cyan-50 text-cyan-800",
  "Like new": "bg-emerald-50 text-emerald-700",
  Good: "bg-sand text-charcoal-600",
  Fair: "bg-amber-50 text-amber-700",
};

/**
 * One listing in a grid.
 *
 * A classifieds card, not a product card: it leads with price, then condition
 * and where the item is, because those are what decide whether a listing is
 * worth opening. There is no cart, quantity or buy action — the next step is
 * always "view the listing and contact the seller".
 */
function ListingCard({ listing }: ListingCardProps) {
  const { isSaved, toggle } = useSavedListings();
  const saved = isSaved(listing.id);

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 shadow-sm shadow-charcoal-900/5 transition duration-200 hover:-translate-y-0.5 hover:border-charcoal-200 hover:shadow-lg hover:shadow-charcoal-900/10 motion-reduce:hover:translate-y-0">
      <Link to={`/listing/${listing.id}`} className="block">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-sand">
          <ImageWithLoader
            src={listing.image}
            alt={listing.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm backdrop-blur-sm ${
              CONDITION_STYLE[listing.condition] ?? "bg-gradient-to-r from-cyan-50/95 to-mint-50/95 text-charcoal-700"
            }`}
          >
            {listing.condition}
          </span>
        </div>

        <div className="p-3">
          <p className="text-base font-black tracking-tight text-charcoal-900">
            {formatPrice(listing.price)}
          </p>
          <h3 className="mt-1 line-clamp-2 min-h-[2.4em] text-sm leading-snug text-charcoal-700">
            {listing.title}
          </h3>

          <p className="mt-2 text-[11px] uppercase tracking-wide text-charcoal-400">
            {listing.categoryLabel}
          </p>

          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-charcoal-500">
            <span className="flex min-w-0 items-center gap-1">
              <FiMapPin size={10} className="flex-shrink-0" />
              <span className="truncate">
                {placeLabel(listing.location, listing.city)}
              </span>
            </span>
            <span className="flex-shrink-0">{relativeTime(listing.postedAt)}</span>
          </div>
        </div>
      </Link>

      {/* Outside the Link, so saving never navigates by accident */}
      <button
        type="button"
        onClick={() => toggle(listing.id)}
        aria-label={saved ? "Remove from saved" : "Save this listing"}
        aria-pressed={saved}
        className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-cyan-50/95 to-mint-50/95 shadow-sm backdrop-blur-sm transition hover:scale-105 ${
          saved ? "text-cyan-600" : "text-charcoal-700"
        }`}
      >
        <FiHeart size={14} fill={saved ? "currentColor" : "none"} />
      </button>
    </article>
  );
}

export default ListingCard;
