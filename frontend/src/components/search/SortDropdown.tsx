import { SORT_OPTIONS, type SortKey } from "../../lib/search";
import { Select } from "../common/Dropdown";

type SortDropdownProps = {
  value: SortKey;
  onChange: (sort: SortKey) => void;
  /** Relevance needs a query to rank against. */
  hasQuery: boolean;
};

/**
 * Result ordering.
 *
 * "Relevance" is disabled without a search term: there is nothing to rank
 * against, and offering it would produce an order the shopper cannot explain.
 */
function SortDropdown({ value, onChange, hasQuery }: SortDropdownProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-charcoal-500">
      <span className="hidden sm:inline">Sort</span>
      <Select
        size="sm"
        value={value}
        onChange={(next) => onChange(next as SortKey)}
        aria-label="Sort results"
      >
        {SORT_OPTIONS.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.value === "relevance" && !hasQuery}
          >
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export default SortDropdown;
