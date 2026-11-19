import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Form fields. Every control has a visible label, an optional hint and an error that says what
 * to do. Ids are explicit (pass `id`), which keeps server and client markup identical and makes
 * the label, hint and error wiring impossible to forget.
 */

export function fieldIds(id: string) {
  return { hint: `${id}-hint`, error: `${id}-error` };
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = fieldIds(id);
  const parts = [hint ? ids.hint : null, error ? ids.error : null].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

export interface FieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** What went wrong and what to do, in one sentence. Presence marks the control invalid. */
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label, control, hint and error stacked with the right spacing. Use the *Field components below unless you need a custom control. */
export function Field({ id, label, hint, error, optional, className, children }: FieldProps) {
  const ids = fieldIds(id);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-faint"> (optional)</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={ids.hint} className="text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={ids.error} className="flex items-start gap-2 text-sm font-medium text-vermilion-ink" role="alert">
          <span aria-hidden="true" className="mt-[0.45em] size-1.5 shrink-0 rotate-45 bg-current" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

const control =
  "w-full rounded-doc bg-sheet text-base text-ink shadow-[inset_0_0_0_1px_var(--rule)] transition-shadow duration-150 " +
  "placeholder:text-ink-faint hover:shadow-[inset_0_0_0_1px_var(--ink-soft)] " +
  "focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] focus-visible:outline-offset-2 " +
  "aria-invalid:shadow-[inset_0_0_0_1.5px_var(--vermilion)] " +
  "disabled:cursor-not-allowed disabled:bg-paper-deep disabled:text-ink-soft";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** Use for addresses, amounts and hashes. */
  mono?: boolean;
  invalid?: boolean;
  className?: string;
}

export function Input({ mono, invalid, className, ...props }: InputProps) {
  return (
    <input
      className={cn(control, "min-h-12 px-3.5", mono && "font-mono text-sm", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  invalid?: boolean;
  className?: string;
}

export function Textarea({ invalid, className, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(control, "min-h-28 px-3.5 py-3 leading-relaxed", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  invalid?: boolean;
  className?: string;
}

export function Select({ invalid, className, children, ...props }: SelectProps) {
  return (
    <span className="relative block">
      <select
        className={cn(control, "min-h-12 appearance-none pr-10 pl-3.5", className)}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-soft"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5.5 8 4.5 4.5L14.5 8" />
      </svg>
    </span>
  );
}

type FieldChrome = Pick<FieldProps, "label" | "hint" | "error" | "optional"> & { id: string; fieldClassName?: string };

export function TextField({ id, label, hint, error, optional, fieldClassName, ...input }: FieldChrome & Omit<InputProps, "id">) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={fieldClassName}>
      <Input
        id={id}
        invalid={Boolean(error)}
        aria-describedby={describedBy(id, hint, error)}
        {...input}
      />
    </Field>
  );
}

export function TextareaField({
  id,
  label,
  hint,
  error,
  optional,
  fieldClassName,
  ...textarea
}: FieldChrome & Omit<TextareaProps, "id">) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={fieldClassName}>
      <Textarea id={id} invalid={Boolean(error)} aria-describedby={describedBy(id, hint, error)} {...textarea} />
    </Field>
  );
}

export function SelectField({
  id,
  label,
  hint,
  error,
  optional,
  fieldClassName,
  children,
  ...select
}: FieldChrome & Omit<SelectProps, "id">) {
  return (
    <Field id={id} label={label} hint={hint} error={error} optional={optional} className={fieldClassName}>
      <Select id={id} invalid={Boolean(error)} aria-describedby={describedBy(id, hint, error)} {...select}>
        {children}
      </Select>
    </Field>
  );
}
