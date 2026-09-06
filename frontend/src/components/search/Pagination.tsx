import { FiChevronLeft, FiChevronRight } from "react-icons/fi";

/** A resume point from the current page, handed back on the next request. */
type Cursor = { value: string; dir: "next" | "prev" };

type PaginationProps = {
  page: number;
  pageCount: number;
  /** From the current page's response — see `SearchParams.cursor`. */
  nextCursor: string | null;
  prevCursor: string | null;
  onChange: (page: number, cursor?: Cursor) => void;
};

/**
 * Page controls.
 *
 * Shows a window around the current page rather than every page number: at a
 * hundred thousand listings there are thousands of pages, and rendering them all
 * would be a wall of numbers nobody can use.
 *
 * Previous/Next hand back the cursor the current page arrived with, so that
 * step seeks by index instead of by OFFSET — the one navigation someone
 * actually takes hundreds of times in a row, and so the one worth being cheap
 * regardless of how deep it has gone. Jumping to a numbered, first, or last
 * page is not adjacent to what is on screen, so those fall back to a plain
 * page number and let the server OFFSET to it directly.
 */
function Pagination({ page, pageCount, nextCursor, prevCursor, onChange }: PaginationProps) {
  if (pageCount <= 1) return null;

  const window = 2;
  const from = Math.max(1, page - window);
  const to = Math.min(pageCount, page + window);
  const pages = Array.from({ length: to - from + 1 }, (_, index) => from + index);

  const button =
    "flex h-9 min-w-9 items-center justify-center rounded-full border border-taupe px-3 text-sm font-semibold text-charcoal-700 transition hover:border-charcoal-300 hover:text-charcoal-900 disabled:opacity-40 disabled:hover:border-taupe disabled:hover:text-charcoal-700";

  return (
    <nav
      aria-label="Pagination"
      className="mt-10 flex flex-wrap items-center justify-center gap-2"
    >
      <button
        type="button"
        onClick={() => onChange(page - 1, prevCursor ? { value: prevCursor, dir: "prev" } : undefined)}
        disabled={page <= 1}
        aria-label="Previous page"
        className={button}
      >
        <FiChevronLeft size={16} />
      </button>

      {from > 1 && (
        <>
          <button type="button" onClick={() => onChange(1)} className={button}>
            1
          </button>
          {from > 2 && <span className="px-1 text-charcoal-400">…</span>}
        </>
      )}

      {pages.map((entry) => {
        // A number adjacent to the current page is the same request the
        // chevron next to it would make — worth the same cursor seek.
        const seek =
          entry === page - 1 && prevCursor
            ? ({ value: prevCursor, dir: "prev" } as const)
            : entry === page + 1 && nextCursor
              ? ({ value: nextCursor, dir: "next" } as const)
              : undefined;

        return (
          <button
            key={entry}
            type="button"
            onClick={() => onChange(entry, seek)}
            aria-current={entry === page ? "page" : undefined}
            className={
              entry === page
                ? "flex h-9 min-w-9 items-center justify-center rounded-full bg-mist px-3 text-sm font-bold text-charcoal-900 shadow-sm shadow-cyan-500/30"
                : button
            }
          >
            {entry}
          </button>
        );
      })}

      {to < pageCount && (
        <>
          {to < pageCount - 1 && <span className="px-1 text-charcoal-400">…</span>}
          <button
            type="button"
            onClick={() => onChange(pageCount)}
            className={button}
          >
            {pageCount}
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1, nextCursor ? { value: nextCursor, dir: "next" } : undefined)}
        disabled={page >= pageCount}
        aria-label="Next page"
        className={button}
      >
        <FiChevronRight size={16} />
      </button>
    </nav>
  );
}

export default Pagination;
