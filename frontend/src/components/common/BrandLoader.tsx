/**
 * The full-viewport branded loader shown while a route's code and its first data
 * are still arriving.
 *
 * Distinct from `Skeleton`/`ListingGridSkeleton`, which are placeholders *inside*
 * a page that has already appeared. This one covers everything — header, footer
 * and all — so a navigation never shows a half-built page. Once the data lands
 * this unmounts and the real page fades in behind it.
 *
 * Branded rather than generic on purpose: the mark is the same typographic "B"
 * badge and BAZAAR wordmark the header carries (there is no image asset — the
 * logo is type, so it needs nothing loaded and stays crisp at any size). The
 * backdrop is the same blue-to-light-blue gradient the page body carries, so
 * the loader reads as the site itself arriving rather than a separate screen
 * placed in front of it; the dark mark keeps full contrast against it.
 *
 * `fixed inset-0` plus `z-[100]` puts it above the sticky header; the grid is
 * centred on both axes at every breakpoint, and the mark scales up a step on
 * larger screens rather than being laid out differently.
 */
type BrandLoaderProps = {
  /** Announced to assistive tech. Worth setting when the wait has a subject. */
  label?: string;
};

function BrandLoader({ label = "Loading" }: BrandLoaderProps) {
  return (
    <div
      // aria-busy rather than a live region: the status line below does the
      // announcing, and a whole-screen live region would be read on every route.
      aria-busy
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-gradient-to-br from-cyan-200 to-cyan-50 px-6"
    >
      {/* Badge + halo share a stacking context so the halo can sit behind the
          mark without a wrapper of its own in the layout. */}
      <span className="relative flex items-center justify-center">
        <span
          aria-hidden
          className="absolute h-16 w-16 rounded-3xl bg-charcoal-900 animate-[brand-halo_2.4s_ease-in-out_infinite] motion-reduce:hidden sm:h-20 sm:w-20"
        />

        <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-charcoal-900 text-3xl font-black text-white shadow-lg animate-[brand-breathe_2.4s_ease-in-out_infinite] motion-reduce:animate-none sm:h-20 sm:w-20 sm:text-4xl">
          B
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[logo-shine_2.6s_ease-in-out_infinite] motion-reduce:hidden"
          />
        </span>
      </span>

      <span className="text-lg font-black tracking-tight text-charcoal-900 sm:text-xl">
        BAZAAR
      </span>

      {/* Indeterminate bar: a short segment sweeping a track, so the wait reads
          as movement rather than a frozen screen. Under reduced motion the
          track alone remains, which still marks the page as busy. */}
      <span className="relative block h-1 w-32 overflow-hidden rounded-full bg-taupe">
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-charcoal-900/70 animate-[route-progress_1.1s_ease-in-out_infinite] motion-reduce:hidden"
        />
      </span>

      <span role="status" className="sr-only">
        {label}…
      </span>
    </div>
  );
}

export default BrandLoader;
