import type { FacetValue } from "../../lib/search";

type FacetCheckboxListProps = {
  options: FacetValue[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  emptyLabel?: string;
};

/**
 * A checkbox list with a count beside every option.
 *
 * The count is a facet count: how many listings that option would produce
 * *given the other filters already applied*. Because each group is counted with
 * its own filter left out, the siblings of a selected option keep real counts
 * and stay switchable — so a zero here means "nothing matches", not "you picked
 * something else".
 */
function FacetCheckboxList({
  options,
  selected,
  onToggle,
  emptyLabel = "Nothing matches the other filters",
}: FacetCheckboxListProps) {
  if (options.length === 0) {
    return <p className="text-xs text-charcoal-400">{emptyLabel}</p>;
  }

  return (
    <>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-center justify-between gap-2 text-sm text-charcoal-700"
        >
          <span className="flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              checked={selected.has(option.value)}
              onChange={() => onToggle(option.value)}
              className="h-4 w-4 flex-shrink-0 rounded border-taupe text-cyan-600 focus:ring-cyan-500"
            />
            <span className="truncate">{option.label}</span>
          </span>
          <span className="flex-shrink-0 text-charcoal-400">
            ({option.count.toLocaleString("en-IN")})
          </span>
        </label>
      ))}
    </>
  );
}

export default FacetCheckboxList;
