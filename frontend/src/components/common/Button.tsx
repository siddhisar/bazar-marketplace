import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, type LinkProps } from "react-router-dom";

/**
 * The one button look, used everywhere a click does something.
 *
 * Two variants, not a dozen near-duplicate class strings copy-pasted per
 * page (that scatter is what this component replaces):
 *
 *   - `primary` — permanently filled (`bg-mist`). Reserved for the one main
 *     action of whatever it's on — a form's submit button, "Contact
 *     Seller" — mirroring the Navbar's own long-standing rule that a filled
 *     button marks *the* action, not merely *an* action. "Sell Something"
 *     itself is `outline`, not this — see Navbar.tsx.
 *   - `outline` — a blue (`cyan-500`) border, visible at rest, with the same
 *     light `bg-mist` wash the Categories dropdown already uses. Neither
 *     hover nor `:active` changes the border or fill colour at all — every
 *     other button on the site used to shift to a different border/text
 *     colour on hover (or fill solid on press), which is exactly the
 *     inconsistency this button exists to remove. A press only dims the
 *     whole button slightly (`brightness`), the same momentary "pressed"
 *     cue without permanently competing with a real `primary` button for
 *     attention, then returns to the plain border-only look the instant
 *     it's released.
 *
 * `danger` is kept as a third, narrow variant for the one place the app
 * asks "are you sure you want to destroy this" (ConfirmDialog's destructive
 * confirm) — a red fill there is a deliberate exception, not a fourth option
 * meant for general use.
 *
 * One `size` scale (not each call site inventing its own padding) fixes the
 * height, horizontal padding, gap and text size together, so two buttons of
 * the same size are pixel-identical regardless of which page they're on.
 * `md` matches the Navbar's own controls (`h-11`) exactly, since that's the
 * reference this whole component was built from.
 *
 * Polymorphic on purpose: a "button" in this app is sometimes a real
 * `<button>`, sometimes a `<Link>` (an action that navigates rather than
 * submits). Passing `to` renders a `<Link>`, `href` renders a plain `<a>`,
 * and otherwise it's a `<button type="button">` — the same visual classes
 * either way, so a page never has to choose between "the right element" and
 * "the right look."
 */
export type ButtonVariant = "primary" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-mist text-charcoal-900 shadow-sm shadow-cyan-500/30 hover:shadow-md hover:shadow-cyan-500/40 hover:brightness-105 active:brightness-95",
  outline:
    "border border-cyan-500 bg-mist text-charcoal-900 hover:border-cyan-500 hover:bg-mist hover:text-charcoal-900 active:brightness-90",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-700",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 px-4 text-xs",
  md: "h-11 gap-2 px-5 text-sm",
  lg: "h-14 gap-2.5 px-8 text-base",
};

const BASE_CLASSES =
  "inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold transition disabled:cursor-not-allowed disabled:opacity-50";

type SharedProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretches to the width of its container — most full-width form submits want this. */
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
};

type AsButton = SharedProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof SharedProps> & {
    to?: undefined;
    href?: undefined;
  };

type AsLink = SharedProps &
  Omit<LinkProps, keyof SharedProps | "to"> & {
    to: LinkProps["to"];
    href?: undefined;
  };

type AsAnchor = SharedProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof SharedProps | "href"> & {
    href: string;
    to?: undefined;
  };

export type ButtonProps = AsButton | AsLink | AsAnchor;

function buttonClassName({
  variant = "primary",
  size = "md",
  fullWidth,
  className,
}: Pick<SharedProps, "variant" | "size" | "fullWidth" | "className">): string {
  return [
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth ? "w-full" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const { variant, size, fullWidth, className, children, ...rest } = props;
    const classes = buttonClassName({ variant, size, fullWidth, className });

    if ("to" in rest && rest.to !== undefined) {
      const { to, ...linkRest } = rest as Omit<AsLink, keyof SharedProps>;
      return (
        <Link
          ref={ref as React.Ref<HTMLAnchorElement>}
          to={to}
          className={classes}
          {...linkRest}
        >
          {children}
        </Link>
      );
    }

    if ("href" in rest && rest.href !== undefined) {
      const anchorRest = rest as Omit<AsAnchor, keyof SharedProps>;
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          className={classes}
          {...anchorRest}
        >
          {children}
        </a>
      );
    }

    const buttonRest = rest as Omit<AsButton, keyof SharedProps>;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type={buttonRest.type ?? "button"}
        className={classes}
        {...buttonRest}
      >
        {children}
      </button>
    );
  },
);

export default Button;

/**
 * The exact same variant/size classes Button itself uses, for the rare case
 * of a component that can't go through Button directly (it must render as
 * something else for unrelated reasons) but still needs to look identical.
 */
export { buttonClassName };
