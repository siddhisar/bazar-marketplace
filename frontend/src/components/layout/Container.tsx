import type { ReactNode } from "react";

type ContainerProps = {
  /** Extra classes — vertical padding, usually. */
  className?: string;
  /**
   * Caps the content while keeping the page's gutters. Use for reading-width
   * pages (a form, a profile) so their left edge still lines up with the navbar
   * rather than floating in from somewhere else.
   */
  narrow?: "sm" | "md" | "lg" | null;
  children: ReactNode;
};

const NARROW: Record<"sm" | "md" | "lg", string> = {
  sm: "max-w-md",
  md: "max-w-3xl",
  lg: "max-w-5xl",
};

/**
 * The one horizontal container every section uses.
 *
 * Before this there were five different combinations of max-width and padding
 * across the header, hero, category row, footer and each page, so no two
 * sections shared a left edge — which is what made the site look untidy rather
 * than any single element being wrong. Changing the gutters now means changing
 * them here.
 *
 * A fixed pixel max-width on purpose: the root font-size is 17.5px, so a rem
 * cap (max-w-7xl) would work out at 1400px, which is unpredictable to reason
 * about.
 *
 * 1536px, not 1200: at 1200 a 1880px monitor was left with 333px of dead margin
 * on each side, so the header looked like it was floating in the middle of the
 * window rather than using it. This still caps the line length on very wide
 * screens, but stops wasting a third of a normal desktop.
 */
function Container({ className = "", narrow = null, children }: ContainerProps) {
  return (
    <div className={`mx-auto w-full max-w-[1536px] px-5 sm:px-8 lg:px-10 ${className}`}>
      {narrow ? (
        <div className={`mx-auto w-full ${NARROW[narrow]}`}>{children}</div>
      ) : (
        children
      )}
    </div>
  );
}

export default Container;
