import { useState } from "react";
import Container from "../../components/layout/Container";
import { Link } from "react-router-dom";
import {
  FiCheckCircle,
  FiEdit2,
  FiEye,
  FiPlus,
  FiRefreshCw,
  FiTrash2,
} from "react-icons/fi";
import EmptyState from "../../components/common/EmptyState";
import Button from "../../components/common/Button";
import ListingTableSkeleton from "../../components/common/ListingTableSkeleton";
import ImageWithLoader from "../../components/common/ImageWithLoader";
import OfferCard from "../../components/offers/OfferCard";
import ListingViewersModal from "../../components/listings/ListingViewersModal";
import { formatPrice } from "../../lib/format";
import {
  acceptOffer,
  counterOffer,
  deleteListing,
  fetchMyListings,
  fetchReceivedOffers,
  markListingSold,
  rejectOffer,
  renewListing,
} from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { usePageGate } from "../../store/RouteGate";
import { useConfirm } from "../../store/ConfirmContext";
import BackLink from "../../components/common/BackLink";

type ListingStatus = "active" | "sold" | "expired";
/** A fourth, non-listing-status tab: offers received on this seller's listings. */
type DashboardTab = ListingStatus | "offers";

/**
 * What each status is called on screen.
 *
 * The stored value stays "expired" — it is a `listing_status` enum in the
 * database and what search filters on — so only the wording changes here.
 * Sellers see "Out of stock", which describes the item rather than the posting
 * window.
 *
 * Every label on this page comes from this map, so the tab, the badge and the
 * empty state cannot drift apart.
 */
const STATUS_LABEL: Record<ListingStatus, string> = {
  active: "Active",
  sold: "Sold",
  expired: "Out of stock",
};

/** Tab order. Labels come from STATUS_LABEL. */
const TABS: ListingStatus[] = ["active", "sold", "expired"];

const STATUS_STYLE: Record<ListingStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  sold: "bg-sand text-charcoal-600",
  expired: "bg-amber-50 text-amber-700",
};

/**
 * The seller dashboard: the signed-in user's own listings, by status.
 *
 * Everything here is server state. Each action calls its endpoint and then
 * refetches rather than patching a local array, so what is on screen is what is
 * in the database — a reload can never resurrect something deleted, which is
 * exactly what happened while this ran on a fixture.
 *
 * Which listings come back is decided by the session, not by anything sent from
 * here, and every write is checked against `listings.seller_id` on the server.
 */
function MyListings() {
  const [tab, setTab] = useState<DashboardTab>("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The listing whose "who viewed this" modal is open, or null when closed. */
  const [viewingListing, setViewingListing] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const confirm = useConfirm();

  const { data, loading, error, reload } = useApi(fetchMyListings, []);
  const {
    data: offersData,
    loading: offersLoading,
    error: offersError,
    reload: reloadOffers,
  } = useApi(fetchReceivedOffers, []);

  /* First load only. The refetch after each sold/renew/delete leaves the table on
     screen, so gating on `loading` alone would black out the dashboard every time
     a seller pressed a button. */
  usePageGate(loading && !data);

  const listings = data ?? [];
  const offers = offersData ?? [];

  const visible = listings.filter((listing) => listing.status === tab);

  const countFor = (status: ListingStatus) =>
    listings.filter((listing) => listing.status === status).length;

  /** Runs one offer action, then refetches the offers list. */
  const runOffer = async (id: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(id);
    setActionError(null);
    try {
      await action();
      reloadOffers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Runs one action, then refetches.
   *
   * The row is disabled while in flight so a double click cannot fire two
   * deletes, and a failure surfaces the server's message instead of leaving the
   * UI showing a change that did not happen.
   */
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

  const renew = (id: string) => run(id, () => renewListing(id));

  /* Marking sold takes one unit out of stock, so it asks first — but it is
     reversible from the Renew button (once the listing is fully sold out and
     expires), which is why it is not `danger`. A multi-unit listing stays
     active with a lower quantity; only the last unit actually removes it
     from search, so the confirmation says whichever of those is about to
     happen rather than always claiming the listing disappears. */
  const markSold = async (id: string) => {
    const listing = listings.find((entry) => entry.id === id);
    const remainingAfter = (listing?.quantity ?? 1) - 1;
    const ok = await confirm({
      title: "Mark as sold?",
      message:
        remainingAfter > 0
          ? `This marks one unit sold. ${remainingAfter} will remain available.`
          : "This removes the listing from search results. You can put it back later with Renew.",
      confirmLabel: "Mark as sold",
    });
    if (!ok) return;
    return run(id, () => markListingSold(id));
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "Delete listing?",
      message: "Are you sure you want to delete this listing? This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    return run(id, () => deleteListing(id));
  };

  /** Icon-only row action (View / Mark sold / Renew / Delete) — kept small so a row of them fits one table cell. */
  const iconAction =
    "flex h-8 w-8 items-center justify-center rounded-full border border-taupe text-charcoal-600 transition hover:border-charcoal-400 hover:text-charcoal-900";

  return (
    <Container className="py-8" narrow="lg">
      <BackLink className="mb-4" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black tracking-tight text-charcoal-900 sm:text-2xl">
            My Ads
          </h1>
          <p className="mt-1 text-sm text-charcoal-500">
            Manage what you have posted.
          </p>
        </div>

        <Button to="/post-ad" variant="outline" size="sm">
          <FiPlus size={15} />
          Post an Ad
        </Button>
      </div>

      {/* Status tabs */}
      <div
        role="tablist"
        aria-label="Listing status"
        className="mt-6 flex gap-2 border-b border-taupe"
      >
        {TABS.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            onClick={() => setTab(status)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-bold transition ${
              tab === status
                ? "border-cyan-500 text-cyan-700"
                : "border-transparent text-charcoal-500 hover:text-cyan-600"
            }`}
          >
            {STATUS_LABEL[status]} ({countFor(status)})
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={tab === "offers"}
          onClick={() => setTab("offers")}
          className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-bold transition ${
            tab === "offers"
              ? "border-cyan-500 text-cyan-700"
              : "border-transparent text-charcoal-500 hover:text-cyan-600"
          }`}
        >
          Offers Received ({offers.length})
        </button>
      </div>

      {actionError && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700"
        >
          {actionError}
        </p>
      )}

      {tab === "offers" ? (
        offersLoading ? (
          <ListingTableSkeleton />
        ) : offersError ? (
          <div className="mt-8">
            <EmptyState
              title="Could not load your offers"
              description={offersError}
              onRetry={reloadOffers}
            />
          </div>
        ) : offers.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="No offers yet"
              description="When a buyer makes an offer on one of your ads, it shows up here."
            />
          </div>
        ) : (
          <ul className="mt-6 space-y-4">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                viewer="seller"
                busy={busyId === offer.id}
                onAccept={() => runOffer(offer.id, () => acceptOffer(offer.id))}
                onReject={() => runOffer(offer.id, () => rejectOffer(offer.id))}
                onCounter={(price) =>
                  runOffer(offer.id, () => counterOffer(offer.id, price))
                }
              />
            ))}
          </ul>
        )
      ) : loading ? (
        <ListingTableSkeleton />
      ) : error ? (
        <div className="mt-8">
          <EmptyState
            title="Could not load your ads"
            description={error}
            onRetry={reload}
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={`No ${STATUS_LABEL[tab].toLowerCase()} ads`}
            description={
              tab === "active"
                ? "Post an ad and it will show up here."
                : `Nothing here yet.`
            }
          >
            {tab === "active" && (
              <Button to="/post-ad" variant="outline">
                Post an Ad
              </Button>
            )}
          </EmptyState>
        </div>
      ) : (
        /* A horizontal-scroll table rather than a fixed grid: "Listing / Status
           / Views / Expiry" reads left to right at a glance, which a stack of
           cards does not, and it is what a seller checking on their listings
           actually wants — the numbers, not the photos, are the point of this
           page. `overflow-x-auto` on the wrapper plus a `min-w` on the table
           is what keeps every column readable on a phone instead of squashing
           them — the table scrolls sideways there rather than wrapping. */
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
                  Available
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
              {visible.map((listing) => (
                <tr
                  key={listing.id}
                  className="border-b border-taupe last:border-b-0 hover:bg-sand/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/listing/${listing.id}`}
                      className="flex min-w-0 items-center gap-3"
                    >
                      <span className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-sand">
                        <ImageWithLoader
                          src={listing.image}
                          alt={listing.title}
                          skeletonRounded="lg"
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-charcoal-900 hover:underline">
                          {listing.title}
                        </span>
                        <span className="block text-xs font-semibold text-charcoal-500">
                          {formatPrice(listing.price)}
                        </span>
                      </span>
                    </Link>
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        STATUS_STYLE[listing.status as ListingStatus]
                      }`}
                    >
                      {STATUS_LABEL[listing.status as ListingStatus]}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-charcoal-700">
                    {listing.status === "sold"
                      ? "—"
                      : listing.quantity.toLocaleString("en-IN")}
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-charcoal-700">
                    <button
                      type="button"
                      onClick={() =>
                        setViewingListing({ id: listing.id, title: listing.title })
                      }
                      className="rounded-lg px-1.5 py-0.5 underline decoration-taupe decoration-dotted underline-offset-4 transition hover:text-charcoal-900 hover:decoration-charcoal-400"
                      title="See who viewed this listing"
                    >
                      {listing.viewerCount.toLocaleString("en-IN")}
                    </button>
                  </td>

                  <td className="px-4 py-3 text-right text-charcoal-700">
                    {/* A sold item's posting window is no longer meaningful —
                        expires_at still holds whatever date it had when it
                        sold, and showing it would read as a deadline that
                        does not actually apply to a sold listing. */}
                    {listing.status === "sold"
                      ? "—"
                      : new Date(listing.expiresAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Link
                        to={`/listing/${listing.id}`}
                        title="View listing"
                        aria-label={`View ${listing.title}`}
                        className={iconAction}
                      >
                        <FiEye size={13} />
                      </Link>

                      <Link
                        to={`/edit-listing/${listing.id}`}
                        title="Edit listing"
                        aria-label={`Edit ${listing.title}`}
                        className={iconAction}
                      >
                        <FiEdit2 size={13} />
                      </Link>

                      {listing.status === "active" && (
                        <button
                          type="button"
                          disabled={busyId === listing.id}
                          onClick={() => markSold(listing.id)}
                          title="Mark as sold"
                          aria-label={`Mark ${listing.title} as sold`}
                          className={`${iconAction} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <FiCheckCircle size={13} />
                        </button>
                      )}

                      {/* Only an expired listing can be renewed. A sold one is
                          refused by the server anyway — offering the button
                          would just be a route to an error message. */}
                      {listing.status === "expired" && (
                        <button
                          type="button"
                          disabled={busyId === listing.id}
                          onClick={() => renew(listing.id)}
                          title="Renew listing"
                          aria-label={`Renew ${listing.title}`}
                          className={`${iconAction} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <FiRefreshCw size={13} />
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busyId === listing.id}
                        onClick={() => remove(listing.id)}
                        title="Delete listing"
                        aria-label={`Delete ${listing.title}`}
                        className={`${iconAction} hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <FiTrash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ListingViewersModal
        listingId={viewingListing?.id ?? null}
        listingTitle={viewingListing?.title ?? ""}
        onClose={() => setViewingListing(null)}
      />
    </Container>
  );
}

export default MyListings;
