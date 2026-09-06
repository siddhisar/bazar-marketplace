import { Link } from "react-router-dom";
import { FiChevronRight } from "react-icons/fi";

type Crumb = {
  label: string;
  /** Omit on the last crumb — the page you are already on is not a link. */
  to?: string;
};

type BreadcrumbsProps = {
  trail: Crumb[];
};

/**
 * The trail above a page title, e.g. Home / Mobiles / iPhone 15 128GB.
 *
 * Standard on classifieds sites because a listing is usually arrived at from a
 * search rather than by browsing down — the trail is often the only thing
 * telling you where in the category tree you have landed.
 */
function Breadcrumbs({ trail }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-charcoal-500">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;

          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {crumb.to && !last ? (
                <Link
                  to={crumb.to}
                  className="transition hover:text-charcoal-900 hover:underline"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={last ? "truncate font-semibold text-charcoal-900" : ""}
                  aria-current={last ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}

              {!last && (
                <FiChevronRight size={12} className="flex-shrink-0 text-charcoal-300" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
