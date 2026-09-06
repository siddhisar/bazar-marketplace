import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiSearch, FiX } from "react-icons/fi";
import SearchSuggestions from "./SearchSuggestions";
import { fetchSuggestions, type ApiSuggestion } from "../../lib/api";
import { useRecentSearches } from "../../store/RecentSearchesContext";

/** Builds `/search?category=&subcategory=&city=`, dropping whichever is absent. */
function categorySearchUrl(
  suggestion: ApiSuggestion,
  city: string | null,
): string {
  const search = new URLSearchParams();
  search.set("category", suggestion.categorySlug);
  if (suggestion.subcategorySlug) {
    search.set("subcategory", suggestion.subcategorySlug);
  }
  if (city) search.set("city", city);
  return `/search?${search.toString()}`;
}

type SearchBarProps = {
  /** Seeds the box, e.g. when landing on /search?q=iphone. */
  initialQuery?: string;
  /** Carried through so searching from the navbar keeps the chosen city. */
  city?: string | null;
  size?: "default" | "large";
  placeholder?: string;
};

/** Typing should not fire a lookup per keystroke. */
const DEBOUNCE_MS = 250;

/** Below this, a query matches too much of the table to be a useful hint. */
const MIN_QUERY = 2;

/**
 * The search box, with debounced type-ahead suggestions from the database.
 *
 * Submitting navigates to /search with the query in the URL rather than holding
 * it in state — the URL is the source of truth for a search, which is what makes
 * a result page shareable and survive a reload.
 *
 * Suggestions come from `/api/search/suggest`, so they reflect the listings that
 * actually exist. Focusing an empty box shows this browser's recent searches
 * instead, which is the only useful thing to offer before anything is typed.
 */
function SearchBar({
  initialQuery = "",
  city = null,
  size = "default",
  placeholder = "Search for anything...",
}: SearchBarProps) {
  const navigate = useNavigate();
  const { recent, record, remove, clear } = useRecentSearches();
  const [value, setValue] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<ApiSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep in step when the URL changes underneath (back button, a chip cleared).
  useEffect(() => setValue(initialQuery), [initialQuery]);

  /* Debounced, aborted lookup.
   *
   * The AbortController is the important half: a debounce alone still allows a
   * slow reply for "iph" to arrive after a fast one for "iphone" and repopulate
   * the list with matches for text no longer in the box. Cancelling the previous
   * request on each change makes the last one typed the last one applied. */
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timeout = setTimeout(() => {
      fetchSuggestions(trimmed, controller.signal)
        .then(setSuggestions)
        .catch(() => {
          // Aborted, or the lookup failed. Either way the box shows nothing
          // extra rather than an error while someone is mid-word.
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [value]);

  const runSearch = (query: string) => {
    const trimmed = query.trim();
    const search = new URLSearchParams();
    if (trimmed) search.set("q", trimmed);
    if (city) search.set("city", city);

    // Recorded here rather than on the results page: this is the one place that
    // knows the search was deliberately started, as opposed to a URL being
    // opened, reloaded or arrived at with the back button.
    record(trimmed);

    setOpen(false);
    navigate(`/search?${search.toString()}`);
  };

  /**
   * Clicking a category/subcategory suggestion browses into it directly —
   * this is category navigation, not a keyword search, so no `q` is set and
   * the box is cleared rather than filled with the category's name.
   */
  const pickCategory = (suggestion: ApiSuggestion) => {
    setValue("");
    setSuggestions([]);
    setOpen(false);
    navigate(categorySearchUrl(suggestion, city));
  };

  const tall = size === "large";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        runSearch(value);
      }}
      className="relative w-full"
      role="search"
    >
      <div
        // Same cyan-500 border at rest as every other control's chrome
        // (Categories, Location, Sort, ...) — `focus-within:border-cyan-500`
        // is a deliberate no-op restating that same colour, not a change, so
        // typing here never shifts the border the way it used to.
        className={`flex w-full items-center gap-2.5 rounded-full border border-cyan-500 bg-mist px-4 shadow-sm transition-all duration-200 focus-within:border-cyan-500 focus-within:shadow-md focus-within:ring-2 focus-within:ring-cyan-500/20 ${
          tall ? "h-11" : "h-9"
        }`}
      >
        <FiSearch size={tall ? 17 : 15} className="flex-shrink-0 text-charcoal-400" />

        {/* No submit button — searching on Enter keeps this to exactly what
            the box needs to say, matching the plain "icon + input" look
            asked for. Handled explicitly here rather than left to the
            form's implicit-submission behaviour: a text field with no
            visible submit control is exactly the case browsers are least
            consistent about triggering that for, and with no button on
            screen either, a silent no-op on Enter would leave no way to
            search at all. */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runSearch(value);
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          aria-label="Search listings"
          autoComplete="off"
          className="min-w-0 flex-1 truncate bg-transparent text-sm outline-none placeholder:text-charcoal-400"
        />

        {/* Only present when there is something to clear, so the pill does not
            carry a dead control. Focus returns to the input afterwards: clearing
            is nearly always the start of typing something else, and a cleared box
            that has lost focus makes you click it again. */}
        {value !== "" && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              setSuggestions([]);
              inputRef.current?.focus();
              setOpen(true);
            }}
            aria-label="Clear search"
            title="Clear search"
            className="flex-shrink-0 rounded-full p-1 text-charcoal-400 transition hover:bg-sand hover:text-charcoal-900"
          >
            <FiX size={tall ? 16 : 14} />
          </button>
        )}
      </div>

      {open && (
        <SearchSuggestions
          suggestions={suggestions}
          // Only offered when the box is empty; once there is text, live matches
          // are the more useful list.
          // Up to five of the most recent; storage keeps more, the dropdown shows a tidy few.
          recent={value.trim() ? [] : recent.slice(0, 5)}
          loading={loading}
          onPickCategory={pickCategory}
          onPickRecent={(query) => {
            setValue(query);
            runSearch(query);
          }}
          onRemoveRecent={remove}
          onClearRecent={clear}
        />
      )}
    </form>
  );
}

export default SearchBar;
