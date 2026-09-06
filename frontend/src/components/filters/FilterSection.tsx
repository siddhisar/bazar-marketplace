import { useState, type ReactNode } from "react";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";

type FilterSectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * A collapsible group in a filter sidebar. Extracted from the storefront's
 * Shop page so the marketplace search sidebar looks and behaves identically
 * rather than being a second implementation that drifts.
 */
function FilterSection({
  title,
  defaultOpen = true,
  children,
}: FilterSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-taupe py-5 first:pt-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between text-sm font-bold text-charcoal-900"
      >
        {title}
        {isOpen ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
      </button>

      {isOpen && <div className="mt-4 space-y-3">{children}</div>}
    </div>
  );
}

export default FilterSection;
