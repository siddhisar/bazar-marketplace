import Container from "../../components/layout/Container";
import EmptyState from "../../components/common/EmptyState";
import Button from "../../components/common/Button";
import ListingGrid from "../../components/listings/ListingGrid";
import { fetchListing, type ApiListingDetail } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { usePageGate } from "../../store/RouteGate";
import { useSavedListings } from "../../store/SavedListingsContext";
import BackLink from "../../components/common/BackLink";

/**
 * Listings the signed-in user has saved.
 *
 * `useSavedListings()` (store/SavedListingsContext.tsx) is backed by the
 * `saved_listings` table and scoped to the account, not the device — the
 * hook only holds the ids locally as a cache. Each listing behind those ids
 * is fetched fresh here, so a saved listing always shows today's price
 * rather than the one it had when it was saved.
 *
 * Fetched one id at a time because there is no bulk endpoint; `allSettled`
 * means a listing that has since been deleted drops out quietly instead of
 * failing the whole page.
 */
function SavedListings() {
  const { ids } = useSavedListings();

  const { data, loading } = useApi<ApiListingDetail[]>(async () => {
    if (ids.length === 0) return [];
    const results = await Promise.allSettled(ids.map((id) => fetchListing(id)));
    return results
      .filter(
        (result): result is PromiseFulfilledResult<ApiListingDetail> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
  }, [ids.join(",")]);

  usePageGate(loading && !data);

  const saved = data ?? [];

  return (
    <Container className="py-8">
      <BackLink className="mb-4" />

      <h1 className="text-xl font-black tracking-tight text-charcoal-900 sm:text-2xl">
        Saved listings
      </h1>
      <p className="mt-1 text-sm text-charcoal-500">
        {saved.length} {saved.length === 1 ? "listing" : "listings"} saved to your
        account.
      </p>

      <div className="mt-6">
        {loading ? (
          <ListingGrid listings={[]} loading skeletonCount={ids.length || 4} />
        ) : saved.length === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            description="Tap the heart on any listing to keep it here while you decide."
          >
            <Button to="/search" variant="outline">Browse listings</Button>
          </EmptyState>
        ) : (
          <ListingGrid listings={saved} />
        )}
      </div>
    </Container>
  );
}

export default SavedListings;
