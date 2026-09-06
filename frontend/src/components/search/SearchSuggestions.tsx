import { FiClock, FiGrid, FiX } from "react-icons/fi";
import { PANEL_BASE } from "../common/Dropdown";
import type { ApiSuggestion } from "../../lib/api";
import type { RecentSearch } from "../../store/RecentSearchesContext";

type SearchSuggestionsProps = {
  /** Live category/subcategory matches from the taxonomy. Empty while the box is empty. */
  suggestions: ApiSuggestion[];
  /** This browser's previous queries, newest first. */
  recent: RecentSearch[];
  /** True while a lookup for the current text is still in flight. */
  loading?: boolean;
  /** A picked category/subcategory to navigate into. */
  onPickCategory: (suggestion: ApiSuggestion) => void;
  /** A picked past search re-runs as a plain keyword search. */
  onPickRecent: (query: string) => void;
  /** Drops one past search from the list. */
  onRemoveRecent: (query: string) => void;
  onClearRecent: () => void;
};

/**
 * The dropdown under the search box: past searches, or live suggestions.
 *
 * Which one shows depends on whether anything has been typed. An empty box means
 * the person has not said what they want yet, so their own history is the most
 * useful thing to offer; once there is text, matches from the database are.
 *
 * Suggestions are category/subcategory navigation, not individual listings —
 * typing "shirt" offers "Shirts" (under Men's Fashion) to click into, where the
 * existing filters/sort/pagination narrow down to the exact item. This is
 * deliberately not a preview of matching listing titles: with 145,000+ listings,
 * a handful of titles picked essentially at random is a worse start than a
 * correct category to browse.
 */
function SearchSuggestions({
  suggestions,
  recent,
  loading = false,
  onPickCategory,
  onPickRecent,
  onRemoveRecent,
  onClearRecent,
}: SearchSuggestionsProps) {
  const showingRecent = suggestions.length === 0 && recent.length > 0;

  // Nothing to offer, and nothing in flight worth announcing.
  if (suggestions.length === 0 && recent.length === 0 && !loading) return null;

  return (
    <div
      className={`absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto ${PANEL_BASE}`}
    >
      {showingRecent && (
        <div className="flex items-center justify-between px-3 pb-1.5 pt-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">
            Recent searches
          </span>
          <button
            type="button"
            onMouseDown={(event) => {
              // The input's blur closes this list; preventing default keeps focus
              // so the dropdown survives and the cleared state is visible.
              event.preventDefault();
              onClearRecent();
            }}
            className="text-[11px] font-bold text-charcoal-400 transition hover:text-charcoal-900"
          >
            Clear all
          </button>
        </div>
      )}

      <ul role="listbox">
        {showingRecent &&
          recent.map((entry) => (
            /* Same rounded-xl "pill" row as every other dropdown's items
               (dropdownItemClassName in common/Dropdown.tsx) — no hover fill,
               just the row's own text/icon darkening. `group` carries the
               hover down to the icon and label, which sit in a separate
               <button> from the row itself; the remove button's own circular
               hover fill is a distinct icon-button affordance, not this. */
            <li
              key={entry.query}
              className="group flex items-center gap-1 rounded-xl transition-colors duration-150"
            >
              <button
                type="button"
                role="option"
                aria-selected={false}
                // onMouseDown, not onClick: the input's blur fires first and
                // would unmount this list before a click could land.
                onMouseDown={() => onPickRecent(entry.query)}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
              >
                <FiClock
                  size={18}
                  className="flex-shrink-0 text-charcoal-400 transition-colors group-hover:text-charcoal-600"
                />
                <span className="min-w-0 flex-1 truncate text-[15px] text-charcoal-700 transition-colors group-hover:text-charcoal-900">
                  {entry.query}
                </span>
              </button>

              <button
                type="button"
                aria-label={`Remove ${entry.query} from recent searches`}
                onMouseDown={(event) => {
                  // Must not also trigger the row behind it, and must not blur.
                  event.preventDefault();
                  event.stopPropagation();
                  onRemoveRecent(entry.query);
                }}
                className="mr-2 flex-shrink-0 rounded-full p-1.5 text-charcoal-300 transition-all duration-150 hover:scale-110 hover:bg-sand hover:text-charcoal-900 motion-reduce:hover:scale-100"
              >
                <FiX size={17} />
              </button>
            </li>
          ))}

        {suggestions.map((item) => {
          // A subcategory match shows itself as the main line with its parent
          // category underneath ("Shirts" / "Men's Fashion"); a top-level
          // match has nothing more specific to show, so the category is the
          // whole suggestion.
          const primary = item.subcategoryLabel ?? item.categoryLabel;
          const secondary = item.subcategoryLabel ? item.categoryLabel : null;
          const key = `${item.categorySlug}:${item.subcategorySlug ?? ""}`;

          return (
            <li key={key} className="group">
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={() => onPickCategory(item)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150"
              >
                <FiGrid
                  size={18}
                  className="flex-shrink-0 text-charcoal-400 transition-colors group-hover:text-charcoal-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold text-charcoal-700 transition-colors group-hover:text-charcoal-900">
                    {primary}
                  </span>
                  {secondary && (
                    <span className="block truncate text-xs uppercase tracking-wide text-charcoal-400">
                      {secondary}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Only announced when there is nothing else on screen, so the list does
          not jump as results replace a spinner mid-type. */}
      {loading && suggestions.length === 0 && !showingRecent && (
        <p className="px-3 py-2 text-sm text-charcoal-400">Searching…</p>
      )}
    </div>
  );
}

export default SearchSuggestions;
