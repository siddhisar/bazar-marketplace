import { useNavigate } from "react-router-dom";
import { FiArrowLeft } from "react-icons/fi";

type BackLinkProps = {
  /** What the link says. Name the destination where it is known. */
  label?: string;
  /**
   * Where to go when there is nothing to go back to — someone who opened this
   * page from a bookmark, a shared link, or a reload has no in-app history, and
   * `back` would take them off the site entirely.
   */
  fallbackTo?: string;
  /** Spacing at the call site; the page decides how it sits in its layout. */
  className?: string;
};

/**
 * "Back" — one arrow-and-label link for every page that offers a way out.
 *
 * Deliberately quiet: grey text that darkens on hover, not a filled pill. Back is
 * always the secondary action on a page that also has a primary one, and two
 * heavy buttons at opposite ends of a header compete for the eye.
 *
 * Prefers real history so Back returns wherever the visitor actually came from —
 * a category, a search, the homepage — rather than a route guessed in advance.
 */
function BackLink({
  label = "Back",
  fallbackTo = "/home",
  className = "",
}: BackLinkProps) {
  const navigate = useNavigate();

  /* React Router numbers its history entries, and index 0 means this page is the
     first the app rendered — so there is no earlier in-app page to return to and
     `navigate(-1)` would leave the site. */
  const historyIndex = (window.history.state as { idx?: number } | null)?.idx;
  const canGoBack = typeof historyIndex === "number" && historyIndex > 0;

  return (
    <button
      type="button"
      onClick={() => (canGoBack ? navigate(-1) : navigate(fallbackTo))}
      className={`flex items-center gap-2 text-sm font-semibold text-charcoal-500 transition hover:text-charcoal-900 ${className}`}
    >
      <FiArrowLeft size={16} />
      {label}
    </button>
  );
}

export default BackLink;
