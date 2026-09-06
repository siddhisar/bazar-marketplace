import { useEffect } from "react";
import { FiX } from "react-icons/fi";
import FilterSidebar from "./FilterSidebar";
import Button from "../common/Button";
import type { Facets, SearchParams } from "../../lib/search";

type FilterDrawerProps = {
  open: boolean;
  onClose: () => void;
  params: SearchParams;
  facets: Facets;
  onChange: (patch: Partial<SearchParams>) => void;
  onClearAll: () => void;
  activeCount: number;
  /** Result count, so the drawer can say what applying will produce. */
  total: number;
};

/**
 * The filter panel as a full-height sheet, for phones and tablets where there is
 * no room for a sidebar.
 *
 * Filters apply immediately rather than on a "Done" press, so the result count
 * in the footer updates as choices are made and the button is a way out rather
 * than a commitment.
 */
function FilterDrawer({
  open,
  onClose,
  params,
  facets,
  onChange,
  onClearAll,
  activeCount,
  total,
}: FilterDrawerProps) {
  /* Escape closes it, and the page behind must not scroll while it is open. */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filters"
      className="fixed inset-0 z-100 lg:hidden"
    >
      <div
        className="absolute inset-0 cursor-pointer bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-gradient-to-br from-cyan-50 to-mint-50 shadow-2xl">
        <div className="flex items-center justify-between border-b border-taupe px-5 py-4">
          <h2 className="text-base font-black tracking-tight text-charcoal-900">
            Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="flex h-9 w-9 items-center justify-center rounded-full text-charcoal-500 transition hover:bg-sand hover:text-charcoal-900"
          >
            <FiX size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <FilterSidebar
            params={params}
            facets={facets}
            onChange={onChange}
            onClearAll={onClearAll}
            activeCount={activeCount}
          />
        </div>

        <div className="border-t border-taupe px-5 py-4">
          <Button variant="outline" onClick={onClose} fullWidth>
            Show {total.toLocaleString("en-IN")}{" "}
            {total === 1 ? "result" : "results"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default FilterDrawer;
