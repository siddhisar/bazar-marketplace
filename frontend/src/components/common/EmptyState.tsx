import type { ReactNode } from "react";
import { FiAlertCircle, FiInbox, FiRefreshCw } from "react-icons/fi";
import Button from "./Button";

type EmptyStateProps = {
  title: string;
  description?: string;
  /** "error" swaps the icon and offers a retry instead of suggestions. */
  variant?: "empty" | "error";
  /**
   * Which heading tag the title uses. Pass "h1" where this is the whole page —
   * on a page with nothing else, the empty state's title *is* the page heading,
   * and a document with no h1 is one a screen reader cannot summarise.
   */
  as?: "h1" | "h2";
  onRetry?: () => void;
  /** Suggestions, chips, or a call to action. */
  children?: ReactNode;
};

/**
 * The state shown when there is nothing to show.
 *
 * Always carries a way forward — a filter to drop, a retry, somewhere to go.
 * A bare "no results" leaves the visitor to guess what they did wrong, which is
 * the failure the brief calls out.
 */
function EmptyState({
  title,
  description,
  variant = "empty",
  as: Heading = "h2",
  onRetry,
  children,
}: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 px-6 py-16 text-center">
      <span
        className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan-50 to-mint-50 ${
          variant === "error" ? "text-rose-600" : "text-charcoal-500"
        }`}
      >
        {variant === "error" ? <FiAlertCircle size={22} /> : <FiInbox size={22} />}
      </span>

      <Heading className="mt-5 text-lg font-black tracking-tight text-charcoal-900">
        {title}
      </Heading>

      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-charcoal-500">
          {description}
        </p>
      )}

      {children && <div className="mt-5">{children}</div>}

      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-6">
          <FiRefreshCw size={14} />
          Try again
        </Button>
      )}
    </div>
  );
}

export default EmptyState;
