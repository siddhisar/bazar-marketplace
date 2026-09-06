import { useEffect, useRef, useState } from "react";
import Button from "./Button";

/** What a caller can say about the decision it is asking for. */
export type ConfirmOptions = {
  title: string;
  /** The consequence, in a sentence. Skip it when the title already says it. */
  message?: string;
  /** Defaults to "Confirm" — better to name the action, e.g. "Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * `danger` for anything that destroys or cannot be undone: it turns the
   * confirm button red and focuses Cancel instead, so a stray Enter dismisses
   * rather than deletes.
   */
  tone?: "default" | "danger";
};

type ConfirmDialogProps = ConfirmOptions & {
  onConfirm: () => void;
  onCancel: () => void;
};

/** Kept in step with the modal-out / scrim-out durations in index.css. */
const EXIT_MS = 150;

/**
 * The confirmation dialog itself — one look for every "are you sure" on the site.
 *
 * Presentational only: it takes a question and two callbacks and knows nothing
 * about what is being confirmed. Callers reach it through `useConfirm()` rather
 * than rendering it, which is what keeps a single dialog in the tree instead of
 * one per action.
 *
 * Styled from the same vocabulary as the rest of the app — the drawer's
 * `bg-black/50 backdrop-blur-sm` scrim, the site's pill buttons, `font-black`
 * headings — so it reads as part of Bazaar rather than as a component dropped in.
 *
 * Dismissal has three routes, because a dialog that traps you is worse than the
 * browser one it replaces: Cancel, Escape, and clicking outside the panel.
 */
function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  /* Closing is a state rather than an immediate unmount so the exit animation
     can play. The answer is then reported on a timer matched to that animation.
     Deliberately not on `animationend`: that event does not arrive if the
     animation is disabled (reduced motion), replaced, or interrupted, and a
     dialog whose only route out is an event that may never fire is one that gets
     stuck open. A timer always fires, so the worst case is the panel vanishing
     without its fade rather than the page becoming unusable. */
  const [closing, setClosing] = useState<"confirm" | "cancel" | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  /* Focus moves into the dialog on open and returns to whatever opened it on
     close — without that, keyboard focus is left on a button behind the scrim.
     On a destructive prompt the safe choice takes focus. */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const target = tone === "danger" ? cancelRef.current : confirmRef.current;
    target?.focus();
    return () => previous?.focus?.();
  }, [tone]);

  /* Escape cancels, and Tab is kept inside the panel: two buttons is a short
     enough loop to wrap by hand, and it stops tabbing from wandering into the
     page underneath while the question is still open. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setClosing("cancel");
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [cancelRef.current, confirmRef.current].filter(
        (el): el is HTMLButtonElement => Boolean(el)
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /* The page must not scroll behind an open dialog. */
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  /* The callbacks are read through a ref so the timer below can depend on
     `closing` alone. They arrive as inline arrows from the provider, so their
     identity changes on every one of its renders — as a dependency they would
     clear and restart the pending timeout each time, and a dialog whose exit
     timer keeps being reset never actually closes. */
  const handlers = useRef({ onConfirm, onCancel });
  handlers.current = { onConfirm, onCancel };

  /* Report the answer once the exit animation has had its moment. */
  useEffect(() => {
    if (!closing) return;

    const timer = window.setTimeout(() => {
      const { onConfirm: yes, onCancel: no } = handlers.current;
      if (closing === "confirm") yes();
      else no();
    }, EXIT_MS);

    return () => window.clearTimeout(timer);
  }, [closing]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={() => setClosing("cancel")}
        className={`absolute inset-0 cursor-pointer bg-black/50 backdrop-blur-sm ${
          closing
            ? "animate-[scrim-out_150ms_ease-in_forwards]"
            : "animate-[scrim-in_180ms_ease-out]"
        } motion-reduce:animate-none`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? "confirm-message" : undefined}
        className={`relative w-full max-w-sm rounded-2xl bg-gradient-to-br from-cyan-50 to-mint-50 p-6 shadow-2xl ${
          closing
            ? "animate-[modal-out_150ms_ease-in_forwards]"
            : "animate-[modal-in_200ms_ease-out]"
        } motion-reduce:animate-none`}
      >
        <h2
          id="confirm-title"
          className="text-lg font-black tracking-tight text-charcoal-900"
        >
          {title}
        </h2>

        {message && (
          <p id="confirm-message" className="mt-2 text-sm text-charcoal-600">
            {message}
          </p>
        )}

        {/* Cancel first in the DOM so it is the first tab stop, and on a phone
            the buttons stack full width rather than being squeezed side by side. */}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={() => setClosing("cancel")}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            // Same bordered look as Cancel beside it for the ordinary case —
            // a bare, border-less fill here was the odd one out next to
            // Cancel's cyan-500 border. `danger` stays its own solid-red
            // exception (Button.tsx's own carve-out for "this destroys
            // something"), untouched.
            variant={tone === "danger" ? "danger" : "outline"}
            onClick={() => setClosing("confirm")}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
