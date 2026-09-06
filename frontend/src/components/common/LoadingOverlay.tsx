import type { ReactNode } from "react";

type LoadingOverlayProps = {
  /** Whether the wrapped content is currently being refreshed. */
  active: boolean;
  children: ReactNode;
  label?: string;
};

/**
 * Keeps the current content on screen while the next set loads over it.
 *
 * Used where a page already has results and is fetching a *revised* set — a new
 * filter, sort, or page of search. Replacing those with skeletons would throw
 * away a perfectly good screen and make every filter click feel like a full
 * reload; instead the existing results stay, dimmed, with a small "updating"
 * chip, and the new ones fade in when ready.
 *
 * First loads (no results yet) are not this — those show skeletons — so the
 * caller only sets `active` when it already has something to keep.
 */
function LoadingOverlay({
  active,
  children,
  label = "Updating",
}: LoadingOverlayProps) {
  return (
    <div className="relative">
      <div
        className={
          active
            ? "pointer-events-none opacity-50 transition-opacity duration-200"
            : "transition-opacity duration-200"
        }
        aria-busy={active}
      >
        {children}
      </div>

      {active && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-6">
          <span
            role="status"
            className="flex items-center gap-2 rounded-full border border-taupe bg-gradient-to-r from-cyan-50/95 to-mint-50/95 px-4 py-2 text-sm font-semibold text-charcoal-700 shadow-sm backdrop-blur-sm"
          >
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-taupe border-t-charcoal-900 motion-reduce:animate-none" />
            {label}…
          </span>
        </div>
      )}
    </div>
  );
}

export default LoadingOverlay;
