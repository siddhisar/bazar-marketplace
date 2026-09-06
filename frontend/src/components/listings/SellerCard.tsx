import { useState } from "react";
import { FiMail, FiPhone, FiUser } from "react-icons/fi";
import type { ApiSeller } from "../../lib/api";
import { monthYear } from "../../lib/format";
import Button from "../common/Button";

type SellerCardProps = {
  seller: ApiSeller;
  /** False for a sold or expired listing — the item is not actually gettable. */
  available: boolean;
};

/**
 * Who is selling, and how to reach them.
 *
 * Contact details stay hidden until "Contact Seller" is pressed. On a real
 * classifieds site that gate is what stops a scraper collecting every seller's
 * number and address in one pass over every listing page, and it also makes
 * reaching out a deliberate action rather than something that just happens to
 * be sitting in the page's initial HTML.
 *
 * The whole block disappears when the seller has neither a phone nor a contact
 * email on file — true for any account that hasn't been given one. `phone` and
 * `contactEmail` arrive already resolved from the API (see ListingSellerDTO);
 * nothing here invents or formats a number, so what's shown is always real
 * data from the database, dummy or not.
 */
function SellerCard({ seller, available }: SellerCardProps) {
  const [revealed, setRevealed] = useState(false);
  const hasContact = Boolean(seller.phone || seller.contactEmail);

  return (
    <div className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5">
      <h2 className="text-xs font-bold uppercase tracking-wide text-charcoal-500">
        Posted by
      </h2>

      <div className="mt-3 flex items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-charcoal-900 text-white">
          <FiUser size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-charcoal-900">
            {seller.name}
          </p>
          <p className="text-xs text-charcoal-500">
            Member since {monthYear(seller.memberSince)}
          </p>
        </div>
      </div>

      {/* A sold or expired listing has nothing left to buy, so offering to
          contact the seller about it would be misleading — the button simply
          isn't shown, same as "Mark as sold" disappearing once it's sold. */}
      {!available ? (
        <p className="mt-4 text-[11px] leading-relaxed text-charcoal-400">
          This listing is no longer available.
        </p>
      ) : !hasContact ? (
        <p className="mt-4 text-[11px] leading-relaxed text-charcoal-400">
          This seller has not added contact details.
        </p>
      ) : revealed ? (
        <div className="mt-4 rounded-xl border border-taupe bg-white/60 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-charcoal-500">
            Seller Contact
          </h3>

          <dl className="mt-2 space-y-1.5 text-sm text-charcoal-900">
            {seller.phone && (
              <div className="flex items-center gap-2">
                <FiPhone size={13} className="flex-shrink-0 text-charcoal-400" />
                <dt className="sr-only">Phone</dt>
                <dd>{seller.phone}</dd>
              </div>
            )}
            {seller.contactEmail && (
              <div className="flex items-center gap-2">
                <FiMail size={13} className="flex-shrink-0 text-charcoal-400" />
                <dt className="sr-only">Email</dt>
                <dd className="truncate">{seller.contactEmail}</dd>
              </div>
            )}
          </dl>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {seller.phone && (
              <Button
                href={`tel:${seller.phone.replace(/\s+/g, "")}`}
                variant="outline"
                className="flex-1"
              >
                <FiPhone size={14} />
                Call Seller
              </Button>
            )}
            {seller.contactEmail && (
              <Button
                href={`mailto:${seller.contactEmail}`}
                variant="outline"
                className="flex-1"
              >
                <FiMail size={14} />
                Email Seller
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setRevealed(true)} fullWidth className="mt-4">
          <FiPhone size={15} />
          Contact Seller
        </Button>
      )}
    </div>
  );
}

export default SellerCard;
