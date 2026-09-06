import ListingCardSkeleton from "./ListingCardSkeleton";

type ListingGridSkeletonProps = {
  /** How many placeholder cards to show. Defaults to a full first screen. */
  count?: number;
};

/**
 * A grid of listing-card placeholders.
 *
 * The grid classes are copied verbatim from `ListingGrid`, so the skeleton lays
 * out at exactly the same columns and gaps across every breakpoint (two on a
 * phone up to five on a wide screen). Keeping the two in step is what stops the
 * results shifting sideways when they replace the placeholders.
 */
function ListingGridSkeleton({ count = 8 }: ListingGridSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading listings"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    >
      {Array.from({ length: count }).map((_, index) => (
        <ListingCardSkeleton key={index} />
      ))}
    </div>
  );
}

export default ListingGridSkeleton;
