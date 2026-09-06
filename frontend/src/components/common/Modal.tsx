import { useEffect, useRef, type ReactNode } from "react";
import { FiX } from "react-icons/fi";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/**
 * A general "open panel with arbitrary content" dialog — the same scrim/panel
 * chrome as ConfirmDialog.tsx (the `bg-black/50 backdrop-blur-sm` scrim, the
 * `rounded-2xl bg-gradient-to-br from-cyan-50 to-mint-50` panel, the same
 * modal-in/out animation classes from index.css), but taking arbitrary
 * `children` instead of a hardcoded title/message/two-button layout —
 * ConfirmDialog is purpose-built for yes/no questions and has no slot for
 * content like a list. Kept as its own component rather than widening
 * ConfirmDialog's props, since a dialog for "are you sure" and one for
 * "here is some information" want different affordances (an explicit close
 * button here; ConfirmDialog's two buttons already serve that role there).
 *
 * Unlike ConfirmDialog there is no exit-animation delay before unmounting —
 * nothing here depends on reporting a confirm/cancel answer only once the
 * animation finishes, so the parent can simply stop rendering this on close.
 */
function Modal({ open, onClose, title, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 cursor-pointer bg-black/50 backdrop-blur-sm animate-[scrim-in_180ms_ease-out] motion-reduce:animate-none"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-gradient-to-br from-cyan-50 to-mint-50 p-6 shadow-2xl animate-[modal-in_200ms_ease-out] motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="modal-title"
            className="text-lg font-black tracking-tight text-charcoal-900"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 rounded-full p-1.5 text-charcoal-400 transition hover:bg-sand hover:text-charcoal-900"
          >
            <FiX size={18} />
          </button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export default Modal;
