import FacetCheckboxList from "./FacetCheckboxList";
import FilterSection from "./FilterSection";
import {
  POSTED_WITHIN_OPTIONS,
  type Facets,
  type SearchParams,
} from "../../lib/search";

type FilterSidebarProps = {
  params: SearchParams;
  facets: Facets;
  /** Applies a change and resets to page one. */
  onChange: (patch: Partial<SearchParams>) => void;
  onClearAll: () => void;
  activeCount: number;
};

/**
 * The filter panel: category, location, price, condition and recency, each with
 * counts and each clearable on its own without disturbing the others.
 *
 * Every control writes straight through to the URL via `onChange` — no filter
 * state is held here, so the panel cannot disagree with the results beside it.
 */
function FilterSidebar({
  params,
  facets,
  onChange,
  onClearAll,
  activeCount,
}: FilterSidebarProps) {
  /**
   * Every checkbox-based filter group is multi-select the same way: toggling
   * one value in or out of its own array leaves every other selected value —
   * in this group and every other — untouched. `extra` carries a group's own
   * side effect (clearing `subcategory` alongside `categories`, clearing the
   * typed price range alongside `priceBands`), applied on every toggle in
   * that group rather than only when picking the first value, since leaving
   * it second-guesses which toggle "started" a multi-select group.
   */
  const toggleMulti = (
    key: "categories" | "cities" | "conditions" | "priceBands",
    value: string,
    extra?: Partial<SearchParams>,
  ) =>
    onChange({
      [key]: params[key].includes(value)
        ? params[key].filter((entry) => entry !== value)
        : [...params[key], value],
      ...extra,
    });

  const toggleCondition = (value: string) => toggleMulti("conditions", value);

  const toggleCity = (value: string) => toggleMulti("cities", value);

  /**
   * Any change to which categories are selected clears `subcategory` too —
   * it only means anything alongside exactly one category (see
   * SearchParams), and picking a second category or leaving the one it
   * belonged to is exactly what makes it stop applying.
   */
  const toggleCategory = (value: string) =>
    toggleMulti("categories", value, { subcategory: null });

  /**
   * Bands and a typed range are alternatives, not additions (same relationship
   * as categories/subcategory) — picking any band clears whatever was typed.
   */
  const togglePriceBand = (value: string) =>
    toggleMulti("priceBands", value, { minPrice: null, maxPrice: null });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black tracking-tight text-charcoal-900">
          Filters{activeCount > 0 && ` (${activeCount})`}
        </h2>
        {/* Also offered when only a search term is set, so "sofa" with no filters
            can still be cleared from here — onClearAll resets the query too. */}
        {(activeCount > 0 || params.q) && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-sm font-semibold text-charcoal-500 transition hover:text-charcoal-900"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="mt-4">
        <FilterSection title="Category">
          <FacetCheckboxList
            options={facets.category}
            selected={new Set(params.categories)}
            onToggle={toggleCategory}
          />
        </FilterSection>

        <FilterSection title="Location">
          <FacetCheckboxList
            options={facets.city}
            selected={new Set(params.cities)}
            onToggle={toggleCity}
          />
        </FilterSection>

        <FilterSection title="Price">
          <FacetCheckboxList
            options={facets.price}
            selected={new Set(params.priceBands)}
            onToggle={togglePriceBand}
          />

          <div className="flex items-center gap-2 pt-1">
            <input
              type="number"
              min={0}
              placeholder="Min"
              value={params.minPrice ?? ""}
              onChange={(event) =>
                onChange({
                  minPrice: event.target.value === "" ? null : Number(event.target.value),
                  priceBands: [],
                })
              }
              aria-label="Minimum price"
              className="w-full rounded-lg border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
            />
            <span className="text-charcoal-400">–</span>
            <input
              type="number"
              min={0}
              placeholder="Max"
              value={params.maxPrice ?? ""}
              onChange={(event) =>
                onChange({
                  maxPrice: event.target.value === "" ? null : Number(event.target.value),
                  priceBands: [],
                })
              }
              aria-label="Maximum price"
              className="w-full rounded-lg border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
            />
          </div>
        </FilterSection>

        <FilterSection title="Condition">
          <FacetCheckboxList
            options={facets.condition}
            selected={new Set(params.conditions)}
            onToggle={toggleCondition}
          />
        </FilterSection>

        <FilterSection title="Posted within">
          {POSTED_WITHIN_OPTIONS.map((option) => (
            <label
              key={option.days}
              className="flex cursor-pointer items-center gap-2 text-sm text-charcoal-700"
            >
              <input
                type="radio"
                name="posted-within"
                checked={params.postedWithinDays === option.days}
                onChange={() => onChange({ postedWithinDays: option.days })}
                className="h-4 w-4 border-taupe text-cyan-600 focus:ring-cyan-500"
              />
              {option.label}
            </label>
          ))}

          {params.postedWithinDays !== null && (
            <button
              type="button"
              onClick={() => onChange({ postedWithinDays: null })}
              className="text-xs font-semibold text-charcoal-500 transition hover:text-charcoal-900"
            >
              Any time
            </button>
          )}
        </FilterSection>
      </div>
    </div>
  );
}

export default FilterSidebar;
