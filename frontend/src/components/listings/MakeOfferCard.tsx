import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FiCheck, FiTag } from "react-icons/fi";
import { createOffer, fetchMyOffers, updateOffer, type ApiOffer } from "../../lib/api";
import { formatPrice } from "../../lib/format";
import { useAuth } from "../../store/AuthContext";
import { currentReturnPath } from "../../lib/returnTo";
import Button from "../common/Button";

type MakeOfferCardProps = {
  listingId: string;
  listingPrice: number;
  sellerId: number;
  /** False for a sold or expired listing — nothing here applies to those. */
  available: boolean;
};

/**
 * "Make an Offer": a buyer proposes a price on the listing, separate from —
 * and shown alongside — Contact Seller. This is the one entry point for
 * starting a negotiation; once an offer exists, its status and any counter
 * are tracked on "My Offers" and the seller's dashboard, not here.
 *
 * Hidden entirely rather than shown-disabled for the two cases where making
 * an offer is simply not this visitor's action to take: the listing's own
 * owner, and anything not currently active. A signed-out visitor still sees
 * the button (so it's discoverable) but is prompted to log in on request,
 * the same pattern "Save this search" already uses.
 */
function MakeOfferCard({ listingId, listingPrice, sellerId, available }: MakeOfferCardProps) {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // Which the just-finished submit was — captured at the moment it ran, not
  // read back off `isEditing` afterwards: submitting sets `existingOffer` to
  // the (possibly brand-new) offer that came back, which would otherwise make
  // a fresh "Make an Offer" submission misreport itself as an edit once it
  // succeeds, purely because a pending offer now exists.
  const [justEdited, setJustEdited] = useState(false);

  // The buyer's own still-pending offer on this listing, if any — loaded once
  // per signed-in visit so this card can offer "update" rather than letting a
  // second offer attempt fail with "you already have a pending offer".
  const [existingOffer, setExistingOffer] = useState<ApiOffer | null>(null);

  useEffect(() => {
    if (!user) {
      setExistingOffer(null);
      return;
    }
    let current = true;
    fetchMyOffers()
      .then((offers) => {
        if (!current) return;
        const mine = offers.find((o) => o.listingId === listingId && o.status === "pending");
        setExistingOffer(mine ?? null);
      })
      .catch(() => {
        // Nothing to show for this failing is worth surfacing here — the
        // card just falls back to "Make an Offer", and a real duplicate is
        // still caught (and explained) when the submit itself is attempted.
      });
    return () => {
      current = false;
    };
  }, [user, listingId]);

  if (!available || (user && user.id === sellerId)) return null;

  const isEditing = existingOffer !== null;

  const submit = async () => {
    const price = Number(amount);
    if (!amount.trim() || !Number.isFinite(price) || price <= 0) {
      setError("Enter a valid offer amount greater than ₹0.");
      return;
    }

    setSending(true);
    setError(null);
    try {
      const offer = isEditing
        ? await updateOffer(existingOffer.id, price)
        : await createOffer(listingId, price);
      setJustEdited(isEditing);
      setExistingOffer(offer);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that offer.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5">
      <h2 className="text-xs font-bold uppercase tracking-wide text-charcoal-500">
        Negotiate Price
      </h2>

      {sent ? (
        <div className="mt-3 flex items-start gap-2 text-sm text-emerald-700">
          <FiCheck size={16} className="mt-0.5 flex-shrink-0" />
          <p>
            {justEdited ? "Offer updated." : "Offer sent."} Track its status under{" "}
            <Link to="/my-offers" className="font-bold underline decoration-emerald-400 underline-offset-2">
              Offers I Made
            </Link>
            .
          </p>
        </div>
      ) : !user ? (
        <>
          <Button
            variant="outline"
            disabled
            title="Log in to make an offer"
            fullWidth
            className="mt-3"
          >
            <FiTag size={15} />
            Make an Offer
          </Button>
          <p className="mt-2 text-xs text-charcoal-400">
            <Link
              to="/login"
              state={{ from: currentReturnPath(location) }}
              className="font-semibold text-cyan-700 hover:underline"
            >
              Log in
            </Link>{" "}
            to make an offer.
          </p>
        </>
      ) : !open ? (
        isEditing ? (
          <>
            <p className="mt-3 text-sm text-charcoal-700">
              Your offer:{" "}
              <span className="font-bold text-charcoal-900">
                {formatPrice(existingOffer.offeredPrice)}
              </span>{" "}
              — awaiting the seller.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setAmount(String(existingOffer.offeredPrice));
                setOpen(true);
              }}
              fullWidth
              className="mt-3"
            >
              <FiTag size={15} />
              Update Offer
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setOpen(true)} fullWidth className="mt-3">
            <FiTag size={15} />
            Make an Offer
          </Button>
        )
      ) : (
        <div className="mt-3">
          <p className="text-sm text-charcoal-700">
            Seller&apos;s Price:{" "}
            <span className="font-bold text-charcoal-900">{formatPrice(listingPrice)}</span>
          </p>

          <label htmlFor="offer-amount" className="mt-3 block text-xs font-semibold text-charcoal-500">
            Your Offer
          </label>
          <input
            id="offer-amount"
            type="number"
            min={1}
            step="1"
            inputMode="decimal"
            placeholder="e.g. 35000"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError(null);
            }}
            className="mt-1.5 w-full rounded-lg border border-taupe bg-white px-3 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
          />
          {error && <p className="mt-1.5 text-xs text-rose-600">{error}</p>}

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={sending}
              onClick={submit}
              className="flex-1"
            >
              {sending ? "Sending…" : isEditing ? "Update Offer" : "Send Offer"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sending}
              onClick={() => {
                setOpen(false);
                setAmount("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MakeOfferCard;
