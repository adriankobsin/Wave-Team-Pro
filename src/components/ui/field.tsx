"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useFieldErrors } from "./action-form";
import { controlClass } from "./control-class";

export { controlClass };

type FieldShellProps = { label: string; hint?: ReactNode; errors?: string[]; id: string; children: ReactNode; optional?: boolean };

function FieldShell({ label, hint, errors, id, children, optional }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {optional ? <span className="ml-1 font-normal text-ink-muted">(optional)</span> : null}
      </label>
      {children}
      {hint && !errors?.length ? <p id={`${id}-hint`} className="text-xs text-ink-muted">{hint}</p> : null}
      {errors?.length ? (
        <p id={`${id}-error`} className="text-xs text-danger" role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label: string; hint?: ReactNode; errors?: string[]; optional?: boolean };

export function TextField({ label, hint, errors: explicit, optional, className, ...props }: Common & InputHTMLAttributes<HTMLInputElement>) {
  const contextErrors = useFieldErrors(props.name);
  const errors = explicit ?? contextErrors;
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <FieldShell label={label} hint={hint} errors={errors} id={id} optional={optional}>
      <input
        id={id}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClass, className)}
        {...props}
      />
    </FieldShell>
  );
}

export function TextAreaField({ label, hint, errors: explicit, optional, className, ...props }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const contextErrors = useFieldErrors(props.name);
  const errors = explicit ?? contextErrors;
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <FieldShell label={label} hint={hint} errors={errors} id={id} optional={optional}>
      <textarea
        id={id}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClass, "min-h-24", className)}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  errors: explicit,
  optional,
  className,
  children,
  ...props
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  const contextErrors = useFieldErrors(props.name);
  const errors = explicit ?? contextErrors;
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <FieldShell label={label} hint={hint} errors={errors} id={id} optional={optional}>
      <select
        id={id}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClass, "h-10 py-0", className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({ label, hint, ...props }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-1 size-4 accent-[var(--hull)] dark:accent-[var(--brass)]" {...props} />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-ink">{label}</span>
        {hint ? <span className="block text-ink-muted">{hint}</span> : null}
      </label>
    </div>
  );
}
