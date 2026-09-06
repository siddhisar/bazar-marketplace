import { Link, useSearchParams } from "react-router-dom";
import { CATEGORIES } from "../../data/marketplace";

type CategoryStripProps = {
  /**
   * Drop the bottom border, for when the strip shares a row with something else
   * (the saved-searches menu) and the border belongs to the row instead. Without
   * this the two sit above a doubled rule.
   */
  bare?: boolean;
};

/**
 * A single scrolling row of category links, sitting under the search box.
 *
 * The full grid on the homepage is for deciding where to start; this is for
 * switching category without losing your place, which is why it appears above
 * search results rather than on the homepage. Highlights the current category so
 * it doubles as an indicator of where you are.
 */
function CategoryStrip({ bare = false }: CategoryStripProps) {
  const [search] = useSearchParams();
  // Multiple categories can be selected at once from the sidebar now; this
  // strip only has a single active link to highlight, so it shows one only
  // when the search is unambiguously "inside" one category.
  const selected = search.getAll("category");
  const active = selected.length === 1 ? selected[0] : null;

  return (
    <nav
      aria-label="Categories"
      className={bare ? "" : "border-b border-taupe"}
    >
      {/* Horizontal scroll rather than wrapping: thirteen categories on two or
          three wrapped lines pushes the results themselves off the screen. */}
      <ul className="flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <li className="flex-shrink-0">
          <Link
            to="/search"
            className={`block rounded-full px-3.5 py-1.5 text-sm transition ${
              active === null
                ? "bg-mist font-bold text-charcoal-900"
                : "text-charcoal-600 hover:bg-sand hover:text-charcoal-900"
            }`}
          >
            All
          </Link>
        </li>

        {CATEGORIES.map((category) => (
          <li key={category.slug} className="flex-shrink-0">
            <Link
              to={`/search?category=${category.slug}`}
              className={`block whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition ${
                active === category.slug
                  ? "bg-mist font-bold text-charcoal-900"
                  : "text-charcoal-600 hover:bg-sand hover:text-charcoal-900"
              }`}
            >
              {category.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default CategoryStrip;
