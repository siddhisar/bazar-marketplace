import { useNavigate } from "react-router-dom";
import { FiBookmark, FiClock, FiTrash2, FiX } from "react-icons/fi";
import { describeFilters, paramsFromSearch } from "../../lib/search";
import { useSavedSearches } from "../../store/SavedSearchesContext";
import { useRecentSearches } from "../../store/RecentSearchesContext";
import { useAuth } from "../../store/AuthContext";
import { DropdownMenu } from "../common/Dropdown";

/**
 * Searches, reachable from beside the category strip: what was searched
 * recently, and what has been deliberately saved.
 *
 * A dropdown rather than another row: the category strip already scrolls
 * horizontally on a phone, and a second full-width list above the results would
 * push the results themselves off the first screen — which is the thing someone
 * came to look at.
 *
 * The two lists are kept distinct rather than merged. Recent is automatic,
 * device-local and needs no account, so it fills in as soon as anything is
 * searched. Saved is deliberate: §4D of the brief defines it as a search a
 * signed-in person keeps under a name they choose, with its filters and a count
 * of new matches — auto-adding every idle query would empty that of meaning.
 * A bookmark button on a recent row is the bridge between the two.
 *
 * Each saved entry carries what is needed to decide whether to run it again: the
 * keyword, the filters that were applied, and when it was saved. Opening one goes
 * through the stored query string, so it restores exactly, sort and page included.
 *
 * The full page at /saved-searches remains the place to manage them at length;
 * this is the same data, at hand while searching.
 */
function SavedSearchesMenu() {
  const navigate = useNavigate();
  const { searches, save, remove, newCount, markChecked } = useSavedSearches();
  const { recent, remove: removeRecent } = useRecentSearches();
  const { user } = useAuth();

  const openSearch = (id: string, query: string, close: () => void) => {
    void markChecked(id);
    close();
    navigate(`/search?${query}`);
  };

  /** Runs a bare keyword again, the same shape the search box produces. */
  const runRecent = (query: string, close: () => void) => {
    close();
    navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  /** Already-saved keywords, so a recent row does not offer a duplicate save. */
  const savedQueries = new Set(
    searches.map((entry) =>
      (paramsFromSearch(new URLSearchParams(entry.query)).q || "").toLowerCase(),
    ),
  );

  const total = recent.length + searches.length;

  return (
    <DropdownMenu
      className="flex-shrink-0"
      icon={<FiBookmark size={14} className="flex-shrink-0" />}
      label={
        <>
          Searches
          {total > 0 && <span className="text-xs font-bold text-charcoal-900/60">{total}</span>}
        </>
      }
      panelClassName="max-h-[26rem] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto"
      panel={({ close }) => (
        <>
          {total === 0 && (
            <p className="px-4 py-5 text-sm text-charcoal-500">
              Nothing yet. Search for something and it will appear here.
            </p>
          )}

          {/* Recent — fills in from the search box, no account needed. */}
          {recent.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-charcoal-400">
                Recent searches
              </p>
              <ul className="divide-y divide-taupe">
                {recent.map((entry) => (
                  <li key={entry.query} className="flex items-center gap-1 px-2">
                    <button
                      type="button"
                      onClick={() => runRecent(entry.query, close)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2.5 text-left transition hover:bg-sand"
                    >
                      <FiClock size={13} className="flex-shrink-0 text-charcoal-400" />
                      <span className="min-w-0 flex-1 truncate text-sm text-charcoal-900">
                        {entry.query}
                      </span>
                    </button>

                    {/* Promote to a real saved search. Hidden when it is already
                        saved, and gated on an account because §4D's saved
                        searches belong to a user. */}
                    {user && !savedQueries.has(entry.query.toLowerCase()) && (
                      <button
                        type="button"
                        onClick={() =>
                          void save(entry.query, `q=${encodeURIComponent(entry.query)}`)
                        }
                        aria-label={`Save the search ${entry.query}`}
                        title="Save this search"
                        className="flex-shrink-0 rounded-full p-1.5 text-charcoal-300 transition hover:bg-sand hover:text-charcoal-900"
                      >
                        <FiBookmark size={13} />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => removeRecent(entry.query)}
                      aria-label={`Remove ${entry.query} from recent searches`}
                      className="flex-shrink-0 rounded-full p-1.5 text-charcoal-300 transition hover:bg-sand hover:text-charcoal-900"
                    >
                      <FiX size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {searches.length > 0 && (
            <p className="border-t border-taupe px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-charcoal-400">
              Saved searches
            </p>
          )}

          {searches.length > 0 && (
            <ul className="divide-y divide-taupe">
              {searches.map((entry) => {
                const params = paramsFromSearch(new URLSearchParams(entry.query));
                const chips = describeFilters(params);
                const fresh = newCount(entry);

                return (
                  <li key={entry.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openSearch(entry.id, entry.query, close)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-sm font-bold text-charcoal-900">
                          {params.q || entry.name || "All listings"}
                        </span>

                        {chips.length > 0 && (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {chips.map((chip) => (
                              <span
                                key={chip.key}
                                className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-semibold text-charcoal-700"
                              >
                                {chip.label}
                              </span>
                            ))}
                          </span>
                        )}

                        <span className="mt-1.5 block text-[11px] text-charcoal-400">
                          Saved{" "}
                          {new Date(entry.createdAt).toLocaleString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </button>

                      <div className="flex flex-shrink-0 items-center gap-1">
                        {fresh > 0 && (
                          <span className="rounded-full bg-mist px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-900">
                            {fresh} new
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(entry.id)}
                          aria-label={`Delete saved search ${params.q || entry.name}`}
                          className="rounded-full p-1.5 text-charcoal-300 transition hover:bg-sand hover:text-charcoal-900"
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    />
  );
}

export default SavedSearchesMenu;
