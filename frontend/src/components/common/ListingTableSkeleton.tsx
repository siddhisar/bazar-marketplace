import Skeleton from "./Skeleton";

/**
 * Placeholder shaped like the seller dashboard's listings table (MyListings) —
 * same header, the same five columns, and three blank rows so the page does
 * not visibly resize once the real rows arrive.
 */
function ListingTableSkeleton() {
  return (
    <div className="mt-6 overflow-x-auto rounded-2xl border border-taupe">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 text-xs font-bold uppercase tracking-wide text-charcoal-500">
            <th scope="col" className="px-4 py-3 font-bold">
              Listing
            </th>
            <th scope="col" className="px-4 py-3 font-bold">
              Status
            </th>
            <th scope="col" className="px-4 py-3 text-right font-bold">
              Views
            </th>
            <th scope="col" className="px-4 py-3 text-right font-bold">
              Expiry
            </th>
            <th scope="col" className="px-4 py-3 text-right font-bold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 3 }).map((_, index) => (
            <tr key={index} className="border-b border-taupe last:border-b-0">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Skeleton rounded="lg" className="h-12 w-12 flex-shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <Skeleton rounded="full" className="h-4 w-16" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="ml-auto h-3.5 w-8" />
              </td>
              <td className="px-4 py-3">
                <Skeleton className="ml-auto h-3.5 w-20" />
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1.5">
                  <Skeleton rounded="full" className="h-7 w-7" />
                  <Skeleton rounded="full" className="h-7 w-7" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ListingTableSkeleton;
