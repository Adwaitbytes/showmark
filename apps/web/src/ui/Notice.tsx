import type { ReactNode } from "react";
import { cn } from "./cn";

export type NoticeTone = "info" | "success" | "warning" | "danger";

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  /** An inline action such as a link or a quiet button. */
  action?: ReactNode;
  className?: string;
}

const toneMark: Record<NoticeTone, string> = {
  info: "bg-stamp-blue",
  success: "bg-ledger-green",
  warning: "bg-vermilion",
  danger: "bg-vermilion-ink",
};

const toneName: Record<NoticeTone, string> = {
  info: "Note",
  success: "Done",
  warning: "Heads up",
  danger: "Problem",
};

/**
 * A slip of paper tucked into the page: inline guidance, confirmation or warning. The tone is
 * carried by a mark and a spoken prefix, never by colour alone.
 */
export function Notice({ tone = "info", title, children, action, className }: NoticeProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-doc bg-paper-deep px-4 py-3.5 text-base text-ink", className)}
    >
      <span aria-hidden="true" className={cn("mt-[0.55em] size-2 shrink-0 rotate-45", toneMark[tone])} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="sr-only">{toneName[tone]}: </span>
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cn(title ? "text-ink-soft" : "text-ink")}>{children}</div>
        {action ? <div className="pt-1.5">{action}</div> : null}
      </div>
    </div>
  );
}
