import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { ExternalIcon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "quiet";
export type ButtonSize = "md" | "lg";

interface CommonProps {
  /** primary: the one vermilion action on a screen. secondary: solid ink. quiet: everything else. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the container width (useful on phones). */
  block?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;
type NativeAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href">;

export type ButtonProps =
  | (CommonProps & NativeButtonProps & { href?: undefined; pending?: boolean })
  | (CommonProps &
      NativeAnchorProps & {
        href: string;
        external?: boolean;
        /** Passed to next/link. Set false to keep a heavy destination out of this page's first load. */
        prefetch?: boolean;
      });

const base =
  "group/button relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-doc font-medium " +
  "transition-[background-color,box-shadow,color,translate] duration-150 ease-out-quart active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  // Ink on vermilion is 4.56:1 (light) and 5.45:1 (night). The bottom inset reads as the edge of a stamp block.
  primary:
    "bg-vermilion text-on-vermilion shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)] hover:bg-[color-mix(in_oklab,var(--vermilion)_88%,white)] active:shadow-none",
  secondary:
    "bg-ink text-paper shadow-[inset_0_-2px_0_rgb(0_0_0/0.22)] hover:bg-ink-soft active:shadow-none",
  quiet:
    "text-ink shadow-[inset_0_0_0_1px_var(--rule-soft)] hover:bg-paper-deep hover:shadow-[inset_0_0_0_1px_var(--rule)]",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-base",
  lg: "min-h-13 px-7 text-md",
};

function PendingInk() {
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-pill bg-current animate-ink-wait"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * The one button. Renders a Next <Link> when given href, an <a target=_blank> when external,
 * and a <button> otherwise. Minimum height 44 px for thumbs.
 */
export function Button(props: ButtonProps) {
  const { variant = "quiet", size = "md", block = false, leading, trailing, className, children, ...native } = props;
  const classes = cn(base, variants[variant], sizes[size], block && "w-full", className);

  if (native.href !== undefined) {
    const { href, external = false, prefetch, ...anchorProps } = native;
    if (external) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={classes} {...anchorProps}>
          {leading}
          {children}
          {trailing ?? <ExternalIcon className="size-4 opacity-70" />}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    }
    return (
      <Link href={href} prefetch={prefetch} className={classes} {...anchorProps}>
        {leading}
        {children}
        {trailing}
      </Link>
    );
  }

  const { pending = false, type = "button", disabled, ...buttonProps } = native;
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...buttonProps}
    >
      {pending ? <PendingInk /> : leading}
      {children}
      {pending ? null : trailing}
    </button>
  );
}
