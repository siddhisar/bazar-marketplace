import { FiMapPin } from "react-icons/fi";
import { CITY_NAMES } from "../../data/marketplace";
import { Select } from "../common/Dropdown";

type LocationSelectorProps = {
  value: string | null;
  onChange: (city: string | null) => void;
  className?: string;
};

/**
 * City picker. City-level only — the brief rules out map views and radius
 * search, so there is nothing finer to offer and pretending otherwise would
 * imply a precision the data does not have.
 */
function LocationSelector({
  value,
  onChange,
  className = "",
}: LocationSelectorProps) {
  return (
    <Select
      icon={<FiMapPin size={16} className="flex-shrink-0 text-charcoal-400" />}
      aria-label="Location"
      value={value ?? ""}
      onChange={(next) => onChange(next || null)}
      wrapperClassName={className}
    >
      <option value="">All India</option>
      {CITY_NAMES.map((city) => (
        <option key={city} value={city}>
          {city}
        </option>
      ))}
    </Select>
  );
}

export default LocationSelector;
