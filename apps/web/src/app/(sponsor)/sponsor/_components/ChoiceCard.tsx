"use client";

import type { ReactNode } from "react";
import { cn } from "@/ui/cn";

export interface ChoiceCardProps {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  /** Short tag shown beside the title, for example "Recommended". */
  tag?: string;
}

/**
 * A radio choice drawn as a slip of paper: the selected slip is inked with a thicker rule and a filled seal. Native
 * radio input underneath, so arrow keys, labels and screen readers behave as usual.
 */
export function ChoiceCard({ name, value, checked, onChange, title, children, disabled, tag }: ChoiceCardProps) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer gap-3 rounded-doc px-4 py-4 transition-[box-shadow,background-color] duration-150",
        checked ? "bg-sheet shadow-[inset_0_0_0_1.5px_var(--ink)]" : "bg-paper-deep/60 shadow-[inset_0_0_0_1px_var(--rule-soft)] hover:shadow-[inset_0_0_0_1px_var(--rule)]",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
        disabled && "cursor-not-allowed opacity-55",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={cn(
          "mt-1 grid size-4 shrink-0 place-items-center rounded-pill shadow-[inset_0_0_0_1.5px_var(--ink-soft)]",
          checked && "shadow-[inset_0_0_0_1.5px_var(--vermilion)]",
        )}
      >
        {checked ? <span className="size-2 rounded-pill bg-vermilion" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-base font-medium text-ink">
          {title}
          {tag ? <span className="rounded-pill px-2 text-xs font-medium text-ledger-green shadow-[inset_0_0_0_1px_currentColor]">{tag}</span> : null}
        </span>
        {children ? <span className="text-sm text-ink-soft">{children}</span> : null}
      </span>
    </label>
  );
}

export function CheckRow({
  id,
  checked,
  onChange,
  title,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={children ? `${id}-hint` : undefined}
        className="mt-1 size-4.5 shrink-0 cursor-pointer accent-[var(--vermilion)]"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="cursor-pointer text-base font-medium text-ink">
          {title}
        </label>
        {children ? (
          <p id={`${id}-hint`} className="text-sm text-ink-soft">
            {children}
          </p>
        ) : null}
      </div>
    </div>
  );
}
