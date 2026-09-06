import ListingCard from "./ListingCard";
import ListingGridSkeleton from "../common/ListingGridSkeleton";
import type { ListingCardData } from "../../lib/api";

type ListingGridProps = {
  listings: ListingCardData[];
  loading?: boolean;
  /** How many skeletons to show while loading. */
  skeletonCount?: number;
};

/**
 * The responsive grid every listing collection uses — two columns on a phone up
 * to five on a wide screen. Kept in one place so the homepage, search results
 * and category pages cannot drift apart.
 *
 * When `loading` is set it hands off to `ListingGridSkeleton`, which lays out
 * placeholder cards at the very same columns and gaps, so the grid holds its
 * shape from the first paint through to the real results arriving.
 */
function ListingGrid({
  listings,
  loading = false,
  skeletonCount = 8,
}: ListingGridProps) {
  if (loading) {
    return <ListingGridSkeleton count={skeletonCount} />;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}

export default ListingGrid;
