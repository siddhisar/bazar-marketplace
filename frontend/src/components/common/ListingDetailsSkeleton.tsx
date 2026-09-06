import Skeleton from "./Skeleton";

/**
 * Placeholder for the full listing page while the detail request is in flight.
 *
 * Follows the real page's two-column layout — gallery and body on the left, the
 * seller/actions rail on the right — and collapses to one column on small
 * screens exactly as the page does. The caller supplies the `Container`, so
 * this is just the inner content and stays aligned with the loaded page's
 * gutters.
 */
function ListingDetailsSkeleton() {
  return (
    <div role="status" aria-label="Loading listing">
      {/* Breadcrumbs + back link */}
      <Skeleton className="h-3 w-64 max-w-full" />
      <Skeleton className="mt-5 h-3 w-28" />

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
        {/* Left: gallery, then the detail */}
        <div className="min-w-0">
          <Skeleton rounded="2xl" className="aspect-[4/3] w-full" />

          <div className="mt-3 flex gap-2.5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} rounded="xl" className="h-16 w-20 flex-shrink-0" />
            ))}
          </div>

          <div className="mt-8 space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-7 w-40" />
            <Skeleton rounded="full" className="h-6 w-28" />
          </div>

          {/* Facts panel */}
          <div className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>

          {/* Description */}
          <div className="mt-8 space-y-2.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>

        {/* Right: seller card + save action */}
        <aside>
          <div className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5">
            <Skeleton className="h-3 w-20" />
            <div className="mt-4 flex items-center gap-3">
              <Skeleton rounded="full" className="h-11 w-11 flex-shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton rounded="full" className="mt-4 h-11 w-full" />
          </div>
          <Skeleton rounded="full" className="mt-4 h-11 w-full" />
        </aside>
      </div>
    </div>
  );
}

export default ListingDetailsSkeleton;
