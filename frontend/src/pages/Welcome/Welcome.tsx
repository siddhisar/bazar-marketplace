import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiArrowRight } from "react-icons/fi";
import Container from "../../components/layout/Container";
import ImageWithLoader from "../../components/common/ImageWithLoader";
import Button from "../../components/common/Button";
import { fetchDashboard, fetchListings, type ApiListing } from "../../lib/api";
import { formatPrice } from "../../lib/format";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../store/AuthContext";

/** How often the swapping word in the subheading changes. */
const WORD_CYCLE_MS = 1800;

/**
 * The kinds of thing people actually sell here, cycled under the tagline.
 *
 * Real category language rather than invented copy, so the line doubles as a
 * hint of what is on the site.
 */
const CYCLE_WORDS = [
  "phones",
  "laptops",
  "furniture",
  "bicycles",
  "cameras",
  "books",
];

/**
 * Where each floating card sits, and how it is tilted and timed.
 *
 * `--tilt` feeds the rotation into the float keyframe, so a card bobs on its
 * own axis rather than being snapped upright by the animation. Six slots, in
 * two tiers: the outer pair only appear on very wide screens, where there is
 * genuinely room beside the text.
 */
const CARD_SLOTS = [
  /* Two depth tiers. "near" cards are larger, fully opaque and sit in front;
     "far" ones are smaller and slightly faded, which reads as distance and
     stops six equally-weighted cards competing with the headline. */
  { position: "left-[5%] top-[15%]", tilt: "-6deg", duration: "7s", delay: "0s", near: true, wide: false },
  { position: "right-[6%] top-[18%]", tilt: "5deg", duration: "7.8s", delay: "0.5s", near: true, wide: false },
  { position: "left-[9%] bottom-[15%]", tilt: "4deg", duration: "8.5s", delay: "0.9s", near: true, wide: false },
  { position: "right-[8%] bottom-[17%]", tilt: "-5deg", duration: "9s", delay: "1.3s", near: true, wide: false },
  { position: "left-[19%] top-[46%]", tilt: "3deg", duration: "9.5s", delay: "1.7s", near: false, wide: true },
  { position: "right-[20%] top-[44%]", tilt: "-4deg", duration: "8.2s", delay: "2.1s", near: false, wide: true },
];

/**
 * Only listings with real product photography are shown here.
 *
 * Photos come from three places: catalogue product shots under `/images/api/`,
 * per-item photos fetched from Openverse under `/images/items/`, and generated
 * cards under `/images/generated/`. The last two are honest but visually
 * inconsistent — a stock portrait for a textbook, an organisation crest for an
 * exam manual, a grey card where nothing could be found. Fine in a results
 * grid, wrong as the first thing anyone sees.
 *
 * The catalogue shots share a clean, uniform background, so the composition
 * holds together.
 */
const hasProductPhoto = (listing: ApiListing) =>
  listing.image.includes("/images/api/") &&
  !listing.image.includes("placeholder-");

/** How many listings the mobile strip shows in place of the floating cards. */
const MOBILE_PREVIEW = 4;

/**
 * The landing page, at both "/" and "/welcome".
 *
 * A signpost, not a gate and not a question. It used to ask "User or Seller?"
 * and route the answer to two different account types; there is one account
 * system now, so there is nothing to ask — browsing needs no account at all,
 * and the things that do say so at the point of use.
 *
 * The floating cards are real listings from /api/dashboard, photographs and
 * prices included. They previously drew from the local fixture, whose images
 * are generated grey placeholders — which is why the shapes looked empty.
 */
function Welcome() {
  const { user } = useAuth();
  const { data } = useApi(fetchDashboard, []);

  /* A wider page than the dashboard's ten, because filtering to product
     photography discards most rows and six slots still need filling. */
  const { data: pool } = useApi(() => fetchListings({ perPage: 48 }), []);

  const showcase: ApiListing[] = (pool?.items ?? []).filter(hasProductPhoto);
  // Active-only, not the all-time total: a shopper reading "N listings" here
  // means "N things I could actually buy right now" — counting sold/expired
  // rows too would overstate what is really browsable.
  const activeListings = data?.totalActive ?? 0;

  /* One listing per slot, in order, so no two cards show the same item. Slots
     beyond the number available are dropped rather than repeating one. */
  const floating = CARD_SLOTS.map((slot, index) => ({
    ...slot,
    listing: showcase[index],
  })).filter((slot) => slot.listing !== undefined);

  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(
      () => setWordIndex((current) => (current + 1) % CYCLE_WORDS.length),
      WORD_CYCLE_MS,
    );
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-br from-cyan-200 via-cream to-mint-200">
      {/* Two glow blobs drifting over the gradient, the same treatment as the
          homepage hero so this reads as the same product. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] animate-[glow-drift_18s_ease-in-out_infinite] rounded-full bg-cyan-300/40 blur-3xl motion-reduce:animate-none"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -right-32 h-[30rem] w-[30rem] animate-[glow-drift_22s_ease-in-out_infinite_reverse] rounded-full bg-mint-300/40 blur-3xl motion-reduce:animate-none"
      />

      {/* Floating listings. Desktop only — on a narrow screen there is no room
          beside the text and they would sit on top of the words. The mobile
          strip further down carries the same idea safely. */}
      {floating.map((card) => (
        <Link
          key={card.listing.id}
          to={`/listing/${card.listing.id}`}
          style={{
            // Consumed by the float keyframe, so the tilt survives the
            // animation instead of being overwritten by it.
            ["--tilt" as string]: card.tilt,
            animationDuration: card.duration,
            animationDelay: card.delay,
          }}
          className={`group absolute hidden animate-[float-soft_8s_ease-in-out_infinite] motion-reduce:animate-none lg:block ${card.position} ${
            card.wide ? "hidden xl:block" : ""
          } ${card.near ? "w-44" : "w-36 opacity-70"}`}
        >
          <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-50 to-mint-50 shadow-[0_8px_30px_rgba(0,0,0,0.08)] ring-1 ring-charcoal-900/[0.04] transition-all duration-500 ease-out group-hover:-translate-y-2 group-hover:opacity-100 group-hover:shadow-[0_20px_45px_rgba(0,0,0,0.14)]">
            {/* Square crop, so six different photographs still line up as a set
                — mixed aspect ratios were most of why this read as clutter. */}
            <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-cream to-sand">
              {/* Empty alt: decoration around the hero, and the page's own copy
                  already says what the site is. */}
              <ImageWithLoader
                src={card.listing.image}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
              />
              {/* Price as a floating chip on the image rather than a second row
                  of text — it is the one number worth reading at this size. */}
              <span className="absolute bottom-2 left-2 rounded-full bg-gradient-to-r from-cyan-50/95 to-mint-50/95 px-2.5 py-1 text-[12px] font-black text-charcoal-900 shadow-sm backdrop-blur-sm">
                {formatPrice(card.listing.price)}
              </span>
            </div>
            <p className="truncate px-3 py-2 text-[11px] font-semibold text-charcoal-500">
              {card.listing.title}
            </p>
          </div>
        </Link>
      ))}

      <Container className="relative flex flex-1 flex-col justify-center py-16">
        <div className="animate-[fade-in_0.5s_ease-out_both] text-center motion-reduce:animate-none">
          {/* Brand mark, with the light sweep the header logo carries */}
          <span className="relative mx-auto flex h-16 w-16 animate-[pop-in_0.6s_ease-out_both] items-center justify-center overflow-hidden rounded-2xl bg-charcoal-900 text-2xl font-black text-white shadow-lg motion-reduce:animate-none">
            B
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 animate-[logo-shine_3s_ease-in-out_infinite] skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent motion-reduce:animate-none"
            />
          </span>

          <h1 className="mt-7 animate-[pop-in_0.55s_ease-out_both] text-4xl font-black uppercase leading-none tracking-[0.15em] text-charcoal-900 [animation-delay:120ms] motion-reduce:animate-none sm:text-6xl">
            Bazaar Marketplace
          </h1>

          {/* The tagline, assembled word by word so it arrives rather than
              simply appearing. inline-block is what lets each be transformed. */}
          <p className="mt-6 text-2xl font-black tracking-tight text-charcoal-900 sm:text-4xl">
            {["Buy.", "Sell.", "Discover."].map((word, index) => (
              <span
                key={word}
                style={{ animationDelay: `${260 + index * 110}ms` }}
                className="inline-block animate-[pop-in_0.55s_ease-out_both] motion-reduce:animate-none"
              >
                {word}
                {index < 2 ? " " : ""}
              </span>
            ))}
          </p>

          <p className="mx-auto mt-5 max-w-xl animate-[pop-in_0.6s_ease-out_both] text-lg leading-relaxed text-charcoal-500 [animation-delay:560ms] motion-reduce:animate-none">
            Your marketplace for second-hand finds — buy and sell{" "}
            <span
              key={wordIndex}
              className="inline-block animate-[word-swap_0.4s_ease-out_both] font-bold text-cyan-600 motion-reduce:animate-none"
            >
              {CYCLE_WORDS[wordIndex]}
            </span>{" "}
            near you.
          </p>

          <div className="mt-10 flex animate-[pop-in_0.5s_ease-out_both] justify-center [animation-delay:680ms] motion-reduce:animate-none">
            <Button
              to="/home"
              variant="outline"
              size="lg"
              className="group shadow-lg hover:scale-105 motion-reduce:hover:scale-100"
            >
              Browse marketplace
              <FiArrowRight
                size={18}
                className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none"
              />
            </Button>
          </div>

          {!user && (
            <p className="mt-5 animate-[fade-in_0.5s_ease-out_both] text-sm text-charcoal-500 [animation-delay:780ms] motion-reduce:animate-none">
              <Link to="/login" className="font-bold text-charcoal-900 hover:underline">
                Log in
              </Link>{" "}
              or{" "}
              <Link to="/register" className="font-bold text-charcoal-900 hover:underline">
                create an account
              </Link>{" "}
              to sell — browsing needs neither.
            </p>
          )}

          {activeListings > 0 && (
            <p className="mt-4 animate-[fade-in_0.5s_ease-out_both] text-xs text-charcoal-400 [animation-delay:860ms] motion-reduce:animate-none">
              {activeListings.toLocaleString("en-IN")} active listings on Bazaar Marketplace
            </p>
          )}

          {/* The floating cards' job, done safely on a narrow screen: the same
              real listings in a strip that cannot overlap anything. Hidden once
              the floating layout takes over. */}
          {showcase.length > 0 && (
            <div className="mt-12 grid animate-[fade-in_0.6s_ease-out_both] grid-cols-2 gap-3 [animation-delay:900ms] motion-reduce:animate-none sm:grid-cols-4 lg:hidden">
              {showcase.slice(0, MOBILE_PREVIEW).map((listing) => (
                <Link
                  key={listing.id}
                  to={`/listing/${listing.id}`}
                  className="overflow-hidden rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 text-left shadow-sm transition hover:border-charcoal-300"
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-sand">
                    <ImageWithLoader
                      src={listing.image}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-2">
                    <p className="truncate text-[11px] text-charcoal-600">
                      {listing.title}
                    </p>
                    <p className="text-xs font-black text-charcoal-900">
                      {formatPrice(listing.price)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}

export default Welcome;
