import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiStar } from "react-icons/fi";
import Container from "../layout/Container";
import Button from "../common/Button";
import type { ApiListing } from "../../lib/api";

type HeroSearchProps = {
  /**
   * Listings actually live and browsable right now — sold, expired and
   * otherwise inactive rows excluded. The headline claims "N things you
   * could buy today", so it has to be the count someone could actually
   * click into, not every row ever created.
   */
  activeListings: number;
  /** Newest listings, used by the live ticker. Real rows, not sample copy. */
  recent?: ApiListing[];
};

/**
 * Quick searches — the things people most often buy second-hand, spread across
 * categories (phones, electronics, furniture, women's fashion, bikes). Every
 * term is verified to return results in the seed data, because a shortcut that
 * lands on "no results" reads as a broken site on the first click.
 */
const POPULAR = [
  "iPhone",
  "Samsung",
  "Laptop",
  "Camera",
  "Sofa",
  "Dress",
  "Saree",
  "Bicycle",
];


/**
 * The homepage hero: one headline and the searches most people want. The
 * search box itself lives in the header now, not here — one search experience
 * for the whole site rather than a second copy in the middle of the page.
 *
 * Mostly neutral on the page's own off-white background, with the brand
 * colour reserved for the handful of things worth drawing the eye to — the
 * live count, the trust pill, and hover states.
 */
function HeroSearch({ activeListings, recent = [] }: HeroSearchProps) {
  /** Entry animation, staggered so the eye lands on the headline first. */
  const rise = (delayMs: number) =>
    `animate-[rise-in_0.6s_ease-out_both] [animation-delay:${delayMs}ms] motion-reduce:animate-none`;

  /**
   * The headline number counts up from zero on first paint.
   *
   * Runs on a rAF clock rather than a fixed number of steps, so it lands on the
   * real figure at the same moment on a slow phone and a fast desktop. Anyone
   * with reduced-motion set skips straight to the final value — a number
   * animating is decoration, not information.
   */
  const [shownCount, setShownCount] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || activeListings === 0) {
      setShownCount(activeListings);
      return;
    }

    const DURATION = 900;
    const start = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const progress = Math.min((now - start) / DURATION, 1);
      // Ease-out cubic: fast at first, settling gently onto the real number.
      const eased = 1 - (1 - progress) ** 3;
      setShownCount(Math.round(activeListings * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    /* rAF does not run in a backgrounded or non-compositing tab, which left the
       count showing 0 while the API had already returned 127. The number is
       information; the animation is decoration. This guarantees the real value
       lands even if not one frame is ever painted. */
    const settle = setTimeout(() => setShownCount(activeListings), DURATION + 150);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [activeListings]);

  /**
   * A real listing, rotating every few seconds.
   *
   * These are genuine rows from /api/dashboard, not sample copy — the point is
   * to show the marketplace has a pulse, which a static hero cannot do.
   */
  const [tickerIndex, setTickerIndex] = useState(0);

  useEffect(() => {
    if (recent.length < 2) return;
    const timer = setInterval(
      () => setTickerIndex((current) => (current + 1) % recent.length),
      3200,
    );
    return () => clearInterval(timer);
  }, [recent.length]);

  const live = recent[tickerIndex];

  return (
    /* The identity gradient itself, as a soft pastel wash rather than the
       button's full saturation — visible at a glance as the same cyan-to-mint
       pair, without the vivid strength that would fight the dark headline for
       attention or read as a gaming/crypto banner. */
    <section className="relative overflow-hidden bg-gradient-to-br from-cyan-200 via-cream to-mint-200">
      {/* Two glow blobs drifting over the gradient — one of each accent colour
          — for a little extra depth and movement. Decorative and
          pointer-events-none, so they can never interfere with the search box. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[30rem] w-[30rem] animate-[glow-drift_18s_ease-in-out_infinite] rounded-full bg-cyan-300/40 blur-3xl motion-reduce:animate-none"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -right-32 h-[28rem] w-[28rem] animate-[glow-drift_22s_ease-in-out_infinite_reverse] rounded-full bg-mint-300/40 blur-3xl motion-reduce:animate-none"
      />

      <Container className="relative pb-10 pt-16 text-center sm:pt-20 lg:pt-24">
        {/* Live ticker. A real listing rather than a slogan — a marketplace
            claiming to be busy should be able to show it, and this is the one
            thing on the page that could not be faked with static copy. */}
        {live ? (
          <Link
            to={`/listing/${live.id}`}
            className={`group mb-6 inline-flex max-w-full items-center gap-2.5 rounded-full border border-taupe bg-gradient-to-r from-cyan-50/80 to-mint-50/80 py-1.5 pl-1.5 pr-4 text-sm text-charcoal-600 shadow-sm backdrop-blur-sm transition hover:border-charcoal-300 ${rise(0)}`}
          >
            <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center">
              <span
                aria-hidden
                className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none"
              />
              <span
                aria-hidden
                className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"
              />
            </span>
            <span key={live.id} className="min-w-0 animate-[fade-in_0.4s_ease-out_both] truncate motion-reduce:animate-none">
              Just listed in {live.city} —{" "}
              <span className="font-bold text-charcoal-900">{live.title}</span>
            </span>
          </Link>
        ) : (
          <p
            className={`mb-6 inline-flex items-center gap-2 rounded-full bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-800 backdrop-blur-sm ${rise(0)}`}
          >
            <FiStar size={14} className="flex-shrink-0 text-cyan-600" />
            Trusted by buyers and sellers across India
          </p>
        )}

        <h1
          /* Tighter leading as the type grows: at this scale the default line
             height opens a gap wide enough to read as two separate headings.
             Built on the brand name itself rather than a generic "buy & sell"
             line — that sentence works on any classifieds site; this one only
             makes sense on Bazaar. */
          className={`text-3xl font-black italic leading-[1.05] tracking-tight text-charcoal-900 sm:text-5xl lg:text-6xl ${rise(90)}`}
        >
          Your City,
          <br />
          One Big Bazaar
        </h1>

        <p
          className={`mx-auto mt-6 max-w-2xl text-base font-black italic leading-relaxed tracking-tight text-charcoal-500 sm:text-lg ${rise(190)}`}
        >
          <span className="font-black tabular-nums text-cyan-600">
            {shownCount.toLocaleString("en-IN")}
          </span>{" "}
          active listings on Bazaar Marketplace. Find a good deal, or sell what
          you no longer need — free to browse, no account needed.
        </p>

        {/* Popular searches — commonly bought second-hand items. */}
        <div
          className={`mt-8 flex flex-wrap items-center justify-center gap-2 ${rise(280)}`}
        >
          <span className="text-sm text-charcoal-400">Popular:</span>
          {POPULAR.map((term) => (
            <Button
              key={term}
              to={`/search?q=${encodeURIComponent(term)}`}
              variant="outline"
              size="sm"
            >
              {term}
            </Button>
          ))}
        </div>

        {/* A line about what the place is for, in place of the old post-an-ad
            link (posting still lives in the header). The <p> keeps the staggered
            rise-in entrance; the inner span carries the blink — two animations on
            one element would overwrite each other, so they are split across two. */}
        <p className={`mt-9 ${rise(480)}`}>
          <span className="animate-[blink_1.8s_ease-in-out_infinite] text-base font-black italic tracking-tight text-charcoal-900 motion-reduce:animate-none sm:text-lg">
            Second-hand, not second-best — give your things a new home, and find
            your next find nearby. ♻️
          </span>
        </p>
      </Container>
    </section>
  );
}

export default HeroSearch;
