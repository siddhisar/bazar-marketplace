import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ConfirmDialog, {
  type ConfirmOptions,
} from "../components/common/ConfirmDialog";

/**
 * Site-wide confirmation prompts.
 *
 * `useConfirm()` returns an async function shaped like `window.confirm` — ask a
 * question, await a boolean — so replacing a native dialog is a one-line change
 * at the call site and the surrounding control flow is untouched:
 *
 *   if (!(await confirm({ title: "Delete listing?" }))) return;
 *
 * One dialog lives here for the whole app rather than each page rendering its
 * own. That is what stops a second "are you sure" panel appearing over the
 * first, and means the look is changed in one place.
 */
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

type Pending = {
  options: ConfirmOptions;
  resolve: (answer: boolean) => void;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  /* Held in a ref as well as state so `confirm` can stay referentially stable:
     it is a dependency of callbacks all over the app, and a new identity on each
     render would invalidate every one of them. */
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      /* A second question while one is open resolves the first as cancelled.
         Dropping it instead would leave that promise pending forever, and the
         caller awaiting it would silently never continue. */
      pendingRef.current?.resolve(false);

      const next = { options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((answer: boolean) => {
    pendingRef.current?.resolve(answer);
    pendingRef.current = null;
    setPending(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          // Remounts for each new question, so the entrance animation and the
          // initial focus run again rather than being skipped as an update.
          key={pending.options.title + (pending.options.message ?? "")}
          {...pending.options}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * The confirmation prompt, as an awaitable question.
 *
 * @returns true when confirmed; false on Cancel, Escape or a click outside.
 * @throws Error when used outside ConfirmProvider — a silent no-op would be
 *         worse, since a destructive action would then run unconfirmed.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used inside ConfirmProvider");
  }
  return confirm;
}

export default ConfirmProvider;
