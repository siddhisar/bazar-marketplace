/**
 * The shared look for a plain text/textarea field — border, background wash,
 * rounding and focus ring. Not a full wrapping component: unlike Button or
 * Select, every caller's own layout (width, padding, an icon's left offset,
 * `rows` on a textarea) varies too much to standardise into one fixed
 * component, so this is the class string each one composes with its own
 * sizing classes — the same relationship Button.tsx's SIZE_CLASSES has to
 * its BASE_CLASSES, just exported as one piece instead of a lookup table.
 *
 * `border-cyan-500`, always on — not the app's neutral `border-taupe` a
 * field previously only switched to on focus. Every other piece of
 * interactive chrome on the site (a button, a dropdown trigger, the header
 * search box) already uses a permanently-visible `border-cyan-500`; a plain
 * field was the one thing left showing a different, warmer neutral border
 * at rest, which read as an unrelated (and, going by feedback, orange/pink-
 * looking) outline next to everything else's blue. A genuine per-field
 * error state, if one is ever added, should override this with its own
 * `border-rose-*` — same as the app's existing rose-toned error banners —
 * rather than this shared class trying to anticipate it.
 */
export const textFieldClassName =
  "rounded-xl border border-cyan-500 bg-gradient-to-br from-cyan-50 to-mint-50 outline-none transition focus:ring-2 focus:ring-cyan-500/20";
