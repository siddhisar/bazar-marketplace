import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FiChevronDown } from "react-icons/fi";

/**
 * The one dropdown look, used everywhere something opens a list of choices —
 * a menu (Categories, the account menu, the searches menu) or a single-choice
 * picker (sort, location, a form's category/condition/city field).
 *
 * Both share the same trigger chrome (a `cyan-500` border visible at rest,
 * the same light `bg-mist` wash Button's `outline` variant uses, one
 * `FiChevronDown`) and the same panel chrome (`PANEL_BASE` below). Before
 * this, several custom menus each hand-rolled their own open/outside-click/
 * Escape handling, and single-choice fields used a native `<select>` — which
 * cannot be restyled once open: what appears is the browser's own OS-drawn
 * popup, in its own colours and font, with its own arrow drawn *in addition
 * to* whatever icon sits next to it. `DropdownMenu` and `Select` below both
 * render their open panel as ordinary DOM (not delegated to the browser), so
 * there is exactly one look for "this is open" anywhere in the app.
 */

const TRIGGER_BASE =
  "flex items-center gap-2 rounded-full border border-cyan-500 bg-mist text-sm font-semibold text-charcoal-900 shadow-md shadow-cyan-500/20 transition-all duration-200 ease-out motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Exported so a trigger that can't be a plain `<button>`/`<label>` (rare) can
 * still match exactly. Stays the same `bg-mist` open or closed — it used to
 * switch to a darker `bg-mist-dark` while open, which (being noticeably more
 * teal than the rest of this blue-bordered chrome) read as an unwanted
 * colour change and, since `Select`'s own trigger never had that state to
 * begin with, was the actual source of Categories and Location looking
 * inconsistent.
 */
export const dropdownTriggerClassName = `${TRIGGER_BASE} h-11 pl-4 pr-4`;

/**
 * The open panel's chrome — identical whether it holds menu items or choices.
 * Exported so a panel that can't be built from `DropdownMenu`/`Select` (e.g.
 * the search box's suggestions list, which needs richer row content than a
 * plain option) still shares the exact same border/background/shadow/radius/
 * animation rather than a hand-copied approximation.
 */
export const PANEL_BASE =
  "rounded-2xl border border-taupe bg-mist p-2 shadow-xl shadow-charcoal-900/5 animate-[dropdown-in_160ms_ease-out] motion-reduce:animate-none";

/**
 * Shared by every panel's own items — kept exported so a caller that can't go
 * through `DropdownMenu`/`Select` still matches exactly.
 *
 * No hover fill at all, on purpose: a background wash here (first `sand`,
 * then a supposedly-neutral `charcoal-100`) kept reading as an unwanted tint
 * against the panel's own pale-cyan `bg-mist`. Darkening the text on hover is
 * enough of a "you're over this row" cue without introducing a fill colour
 * to get wrong a third time.
 */
export const dropdownItemClassName =
  "block w-full rounded-xl px-3 py-2 text-left text-sm text-charcoal-700 transition hover:text-charcoal-900 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Open state plus "close on an outside click or Escape" — the one behaviour
 * every dropdown here needs, previously copied by hand into each one.
 */
function useDropdownOpen<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return { open, setOpen, rootRef };
}

export type DropdownMenuProps = {
  /** The clickable trigger's own content — an icon, a label, whatever the caller needs; the surrounding chrome and chevron are added here. */
  label: ReactNode;
  /** A leading icon badge, e.g. the grid icon on Categories — kept as its own slot since not every trigger has one. */
  icon?: ReactNode;
  /** The menu's contents, as a function of `close` — so an item's own onClick can dismiss the menu the same way `closeAll` used to. */
  panel: (state: { close: () => void }) => ReactNode;
  /** Extra classes for the panel itself (width, grid layout, ...) — the border/background/shadow/animation stay fixed. */
  panelClassName?: string;
  /**
   * Overrides the trigger's own look — the bordered pill everywhere else
   * (Categories, Location, the saved-searches menu) marks "this opens a
   * menu of choices", but the account entry point is closer kin to a plain
   * nav link (Home, the header's other icons) than to a control someone
   * picks a value from, so it uses this to drop the border/fill instead.
   * Defaults to the shared `dropdownTriggerClassName` when not given.
   */
  triggerClassName?: string;
  align?: "left" | "right";
  className?: string;
  "aria-label"?: string;
};

/**
 * A button that opens a positioned panel underneath it — Categories, the
 * account menu, the saved-searches menu.
 */
export function DropdownMenu({
  label,
  icon,
  panel,
  panelClassName,
  triggerClassName,
  align = "right",
  className,
  "aria-label": ariaLabel,
}: DropdownMenuProps) {
  const { open, setOpen, rootRef } = useDropdownOpen<HTMLDivElement>();
  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={ariaLabel}
        className={triggerClassName ?? dropdownTriggerClassName}
      >
        {icon}
        {label}
        <FiChevronDown
          size={16}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`absolute top-full mt-2 ${PANEL_BASE} ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName ?? ""}`}
        >
          {panel({ close })}
        </div>
      )}
    </div>
  );
}

type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /**
   * Same meaning as a native `<option hidden>`: shown as the trigger's own
   * label when it's the current value (a placeholder like "Choose a
   * category" for nothing picked yet), but left out of the opened list —
   * the heading above the trigger already says "Category", so repeating
   * "Choose a category" as a selectable row under it (which a real choice
   * can never usefully return to) was showing the prompt twice.
   */
  hidden?: boolean;
};

/** Reads the `<option>` elements a caller passed as `children`, same as a native `<select>` would. */
function optionsFromChildren(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (
      !isValidElement<{
        value?: unknown;
        disabled?: boolean;
        hidden?: boolean;
        children?: ReactNode;
      }>(child)
    ) {
      return;
    }
    options.push({
      value: String(child.props.value ?? ""),
      label: child.props.children,
      disabled: child.props.disabled,
      hidden: child.props.hidden,
    });
  });
  return options;
}

export type SelectProps = {
  id?: string;
  /** A leading icon (e.g. a location pin) — the trigger's own slot. */
  icon?: ReactNode;
  size?: "sm" | "md";
  /** Classes for the wrapping element — width, responsive display, etc. The border/background/height stay fixed. */
  wrapperClassName?: string;
  className?: string;
  value: string;
  onChange: (value: string) => void;
  /** Blocks submitting the enclosing form while unset — see `PostAd`'s `handleSubmit`, which checks this explicitly since a plain `<div>` has no native constraint validation to lean on. */
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  /** `<option>` elements, exactly as a native `<select>` would take them. */
  children: ReactNode;
};

const SELECT_SIZE_CLASSES: Record<"sm" | "md", string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-4 text-sm",
};

/**
 * A single-choice picker with the same trigger chrome as `DropdownMenu`, and
 * the same custom-rendered panel — not a native `<select>`. A native one
 * looks right closed, but its open state is drawn by the browser itself and
 * cannot be given this app's colours, font, or spacing; this renders its own
 * panel instead, so open looks exactly like every other dropdown here.
 *
 * Takes `<option>` children the same way a native `<select>` does, so a
 * caller migrating from one reads the same either way — only `onChange` is
 * simpler, receiving the new value directly rather than a change event.
 */
export function Select({
  id,
  icon,
  size = "md",
  wrapperClassName,
  className,
  value,
  onChange,
  required,
  disabled,
  "aria-label": ariaLabel,
  children,
}: SelectProps) {
  const { open, setOpen, rootRef } = useDropdownOpen<HTMLDivElement>();
  const options = optionsFromChildren(children);
  const selected = options.find((option) => option.value === value);

  return (
    <div ref={rootRef} className={`relative ${wrapperClassName ?? ""}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required}
        onClick={() => setOpen((current) => !current)}
        className={`w-full text-left ${TRIGGER_BASE} ${SELECT_SIZE_CLASSES[size]} ${className ?? ""}`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <FiChevronDown
          size={14}
          className={`flex-shrink-0 text-charcoal-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`absolute left-0 top-full z-20 mt-2 max-h-72 w-full min-w-[10rem] overflow-y-auto ${PANEL_BASE}`}
          role="listbox"
        >
          {options
            .filter((option) => !option.hidden)
            .map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                // Same row look as every other dropdown's items, selected or
                // not — a solid cyan-500 fill here used to make an open Select
                // look like a different, darker-hovering dropdown from
                // Categories/DropdownMenu, which have no such highlighted
                // state at all. The trigger itself already shows the current
                // choice; the open panel does not need to repeat it with a
                // fill.
                className={dropdownItemClassName}
              >
                {option.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
