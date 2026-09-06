import { useNavigate } from "react-router-dom";
import Container from "../../components/layout/Container";
import { FiBookmark, FiTrash2 } from "react-icons/fi";
import EmptyState from "../../components/common/EmptyState";
import Button from "../../components/common/Button";
import { describeFilters, paramsFromSearch } from "../../lib/search";
import { useSavedSearches } from "../../store/SavedSearchesContext";
import BackLink from "../../components/common/BackLink";

/**
 * Saved searches, each with how many listings have appeared since it was last
 * checked.
 *
 * Opening one restores the exact search by navigating to its stored query
 * string, and resets the "new" count — the badge means "since you last looked",
 * so looking has to clear it.
 */
function SavedSearches() {
  const navigate = useNavigate();
  const { searches, remove, newCount, markChecked } = useSavedSearches();

  if (searches.length === 0) {
    return (
      <Container className="py-16" narrow="md">
        <EmptyState
          as="h1"
          title="No saved searches yet"
          description="Run a search, then save it to track new listings that match — useful for something you are waiting to come up."
        >
          <Button to="/search" variant="outline">Start searching</Button>
        </EmptyState>
      </Container>
    );
  }

  return (
    <Container className="py-8" narrow="lg">
      <BackLink className="mb-4" />

      <h1 className="text-xl font-black tracking-tight text-charcoal-900 sm:text-2xl">
        Saved searches
      </h1>
      <p className="mt-1 text-sm text-charcoal-500">
        {searches.length} saved. New matches are counted since you last opened
        each one.
      </p>

      <ul className="mt-6 space-y-4">
        {searches.map((entry) => {
          const params = paramsFromSearch(new URLSearchParams(entry.query));
          const chips = describeFilters(params);
          const fresh = newCount(entry);

          return (
            <li
              key={entry.id}
              className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-charcoal-900">
                    <FiBookmark size={14} className="flex-shrink-0" />
                    {entry.name}
                  </h2>

                  {params.q && (
                    <p className="mt-1 text-xs text-charcoal-500">
                      Keyword: <span className="font-semibold">{params.q}</span>
                    </p>
                  )}
                </div>

                {fresh > 0 && (
                  <span className="rounded-full bg-mist px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-charcoal-900">
                    {fresh} new
                  </span>
                )}
              </div>

              {chips.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <span
                      key={chip.key}
                      className="rounded-full bg-sand px-2.5 py-1 text-xs font-semibold text-charcoal-700"
                    >
                      {chip.label}
                    </span>
                  ))}
                </div>
              )}

              <p className="mt-3 text-xs text-charcoal-400">
                Last checked{" "}
                {new Date(entry.lastCheckedAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    markChecked(entry.id);
                    navigate(`/search?${entry.query}`);
                  }}
                >
                  View results
                </Button>

                <Button size="sm" variant="outline" onClick={() => remove(entry.id)}>
                  <FiTrash2 size={12} />
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Container>
  );
}

export default SavedSearches;
