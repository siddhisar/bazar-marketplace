import type { CSSProperties } from "react";

type Rounded = "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";

type SkeletonProps = {
  /** Extra classes — usually the width/height of the block. */
  className?: string;
  style?: CSSProperties;
  /** Corner rounding. Defaults to the small radius the card's text lines use. */
  rounded?: Rounded;
};

const RADIUS: Record<Rounded, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
};

/**
 * The one placeholder block every skeleton on the site is built from.
 *
 * A surface that breathes between a blue-grey and a near-white (the
 * `.skeleton-block` animation, defined in index.css). Kept deliberately plain so
 * a card, a line of text and an image placeholder all share exactly one loading
 * idiom — the thing that makes a set of skeletons read as one system rather than
 * several.
 *
 * Decorative by definition, so it is `aria-hidden`; the surrounding region
 * carries the actual "loading" announcement for assistive tech.
 */
function Skeleton({ className = "", style, rounded = "md" }: SkeletonProps) {
  return (
    <span
      aria-hidden
      style={style}
      className={`skeleton-block block ${RADIUS[rounded]} ${className}`}
    />
  );
}

export default Skeleton;
