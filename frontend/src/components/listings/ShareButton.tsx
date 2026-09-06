import { useEffect, useRef, useState } from "react";
import { FiCheck, FiLink, FiMessageCircle, FiShare2 } from "react-icons/fi";
import { PANEL_BASE, dropdownItemClassName } from "../common/Dropdown";

type ShareButtonProps = {
  /** Used as the native share sheet's title, and the text WhatsApp's link prefixes the URL with. */
  title: string;
  /** Matches the trigger it sits beside (Save listing) rather than the navbar's own dropdown height. */
  className?: string;
};

/**
 * Shares the current listing's URL.
 *
 * The device's native share sheet (`navigator.share`) is tried first — on a
 * phone that already covers WhatsApp and every other installed app directly,
 * which is a better result than anything this app could build by hand.
 * Desktop browsers mostly don't implement it, so the fallback is a small
 * menu with Copy Link and a WhatsApp *web* link — reusing the exact same
 * panel/item chrome every other dropdown in the app uses (common/Dropdown.tsx)
 * rather than a one-off popover, per the "no separate styling" rule the rest
 * of this app already follows.
 */
function ShareButton({ title, className }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const handleTriggerClick = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url: window.location.href });
      } catch {
        // Either the person backed out of the share sheet, or the browser
        // refused — both already communicated their own outcome; nothing
        // here needs to add to it.
      }
      return;
    }
    setOpen((current) => !current);
  };

  const copyLink = async () => {
    // The menu must not get stuck open with no feedback if the write itself
    // fails (blocked permission, an unfocused document, an older browser) —
    // confirmed live: without the try/catch, a rejected writeText left the
    // menu open and the trigger's label unchanged, silently.
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing more targeted to say here — see the comment above.
    } finally {
      setOpen(false);
    }
  };

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${title} — ${window.location.href}`)}`;

  return (
    <div ref={rootRef} className="relative flex-1">
      <button
        type="button"
        onClick={handleTriggerClick}
        aria-haspopup={typeof navigator.share === "function" ? undefined : "menu"}
        aria-expanded={typeof navigator.share === "function" ? undefined : open}
        className={className}
      >
        {copied ? <FiCheck size={15} /> : <FiShare2 size={15} />}
        {copied ? "Link copied" : "Share"}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute left-0 top-full z-20 mt-2 w-full min-w-[11rem] ${PANEL_BASE}`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={copyLink}
            className={`flex items-center gap-2.5 ${dropdownItemClassName}`}
          >
            <FiLink size={14} className="flex-shrink-0" />
            Copy link
          </button>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={`flex items-center gap-2.5 ${dropdownItemClassName}`}
          >
            <FiMessageCircle size={14} className="flex-shrink-0" />
            Share on WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}

export default ShareButton;
