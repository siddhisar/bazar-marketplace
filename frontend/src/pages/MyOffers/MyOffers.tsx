import { useState } from "react";
import Container from "../../components/layout/Container";
import EmptyState from "../../components/common/EmptyState";
import BackLink from "../../components/common/BackLink";
import Button from "../../components/common/Button";
import OfferCard from "../../components/offers/OfferCard";
import { acceptOffer, fetchMyOffers, rejectOffer, updateOffer } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { usePageGate } from "../../store/RouteGate";

/**
 * The buyer side of "Make an Offer": every offer this account has sent,
 * newest activity first, with its current status. A `countered` offer gets
 * this page's main actions — accepting or rejecting the seller's counter,
 * the mirror of "Offers Received" on the seller dashboard — while a still
 * `pending` one (awaiting the seller) offers the one thing left to do with
 * it: revise the price before the seller has responded.
 */
function MyOffers() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi(fetchMyOffers, []);
  usePageGate(loading && !data);

  const offers = data ?? [];

  const run = async (id: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(id);
    setActionError(null);
    try {
      await action();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  };

  if (!loading && offers.length === 0 && !error) {
    return (
      <Container className="py-16" narrow="md">
        <EmptyState
          as="h1"
          title="No offers yet"
          description="Open a listing and use Make an Offer to start a negotiation."
        >
          <Button to="/search" variant="outline">Browse listings</Button>
        </EmptyState>
      </Container>
    );
  }

  return (
    <Container className="py-8" narrow="lg">
      <BackLink className="mb-4" />

      <h1 className="text-xl font-black tracking-tight text-charcoal-900 sm:text-2xl">
        Offers I Made
      </h1>
      <p className="mt-1 text-sm text-charcoal-500">
        Offers you have sent, and the seller&apos;s response.
      </p>

      {actionError && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700"
        >
          {actionError}
        </p>
      )}

      {error ? (
        <div className="mt-8">
          <EmptyState
            title="Could not load your offers"
            description={error}
            onRetry={reload}
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {offers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              viewer="buyer"
              busy={busyId === offer.id}
              onAccept={() => run(offer.id, () => acceptOffer(offer.id))}
              onReject={() => run(offer.id, () => rejectOffer(offer.id))}
              onUpdate={(offeredPrice) => run(offer.id, () => updateOffer(offer.id, offeredPrice))}
            />
          ))}
        </ul>
      )}
    </Container>
  );
}

export default MyOffers;
