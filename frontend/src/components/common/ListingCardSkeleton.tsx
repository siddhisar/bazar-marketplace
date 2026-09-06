import Skeleton from "./Skeleton";

/**
 * Placeholder shaped like a ListingCard.
 *
 * Every block lines up with a real element in `ListingCard` — the 4:3 photo,
 * the price, the two-line title (held at the same `min-h` so the row never
 * changes height), the category label, and the location / time footer. Matching
 * the real card's proportions is the whole point: a skeleton of the wrong
 * height just moves the page-jump to when the data arrives instead of removing
 * it.
 */
function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50">
      <Skeleton rounded="none" className="aspect-[4/3] w-full" />

      <div className="space-y-2 p-3">
        {/* Price */}
        <Skeleton className="h-4 w-1/3" />

        {/* Title — two lines, same reserved height as the real card */}
        <div className="min-h-[2.4em] space-y-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>

        {/* Category */}
        <Skeleton className="h-2.5 w-1/3" />

        {/* Location + posted time */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-10" />
        </div>
      </div>
    </div>
  );
}

export default ListingCardSkeleton;
