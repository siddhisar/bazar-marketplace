import { useState, type InputHTMLAttributes } from "react";
import { FiEye, FiEyeOff, FiLock } from "react-icons/fi";
import { textFieldClassName } from "./Input";

/**
 * A password field with a show/hide toggle, styled to match every other
 * field on the Login/Register forms (the same `field`/`icon` look those
 * pages already define locally) so every password field on the site looks
 * and behaves identically rather than each page growing its own version.
 *
 * Toggling only flips this input's own `type` between "password" and
 * "text" — nothing is copied elsewhere, and the value, name and
 * autocomplete behaviour a password manager relies on are untouched, so
 * this is exactly as safe to reveal as any browser's own built-in toggle.
 *
 * Every other prop (value, onChange, autoComplete, required, minLength,
 * readOnly, onFocus, ...) passes straight through to the `<input>`, so a
 * page can still layer its own behaviour on top — e.g. Login.tsx's
 * autofill-unlock trick — without this component needing to know about it.
 */
type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">;

function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative mt-4">
      <FiLock
        size={16}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-charcoal-400"
      />
      <input
        type={visible ? "text" : "password"}
        className={`w-full ${textFieldClassName} py-3 pl-11 pr-11 text-sm`}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        // A full-height strip rather than an icon-sized hit target, so the
        // tap area is comfortable on a phone (~44px), not just the 16px icon.
        className="absolute inset-y-0 right-0 flex items-center pl-3 pr-3.5 text-charcoal-400 transition hover:text-charcoal-700"
      >
        {visible ? <FiEyeOff size={16} /> : <FiEye size={16} />}
      </button>
    </div>
  );
}

export default PasswordInput;
