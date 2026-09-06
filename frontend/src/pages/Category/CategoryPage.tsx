import { Navigate, useParams } from "react-router-dom";
import { CATEGORIES } from "../../data/marketplace";

/**
 * /category/:slug
 *
 * A category is just a pre-applied filter, so this hands straight over to the
 * search page rather than being a second results implementation that could
 * drift from it. `replace` keeps it out of the history, so Back from the results
 * goes where the visitor came from instead of bouncing through here.
 */
function CategoryPage() {
  const { category } = useParams<{ category: string }>();

  const known = CATEGORIES.some((entry) => entry.slug === category);
  if (!known) return <Navigate to="/search" replace />;

  return <Navigate to={`/search?category=${category}`} replace />;
}

export default CategoryPage;
