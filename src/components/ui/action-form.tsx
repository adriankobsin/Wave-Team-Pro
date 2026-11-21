"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ActionResult } from "@/lib/errors";
import { Notice } from "./misc";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

const FormStateContext = createContext<ActionResult | null>(null);

export function useFieldErrors(name?: string): string[] | undefined {
  const state = useContext(FormStateContext);
  if (!name || !state || state.ok) return undefined;
  return state.fieldErrors?.[name];
}

/**
 * Progressive-enhancement form bound to a Server Action. Shows the action's message,
 * exposes field errors to nested fields, and optionally resets after success.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  hideMessage,
  confirm,
  id,
  "aria-label": ariaLabel,
}: {
  id?: string;
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  hideMessage?: boolean;
  confirm?: string;
  "aria-label"?: string;
}) {
  const [state, formAction] = useActionState(action, { ok: true } as ActionResult);
  const ref = useRef<HTMLFormElement>(null);
  const hasMessage = state.ok ? Boolean(state.message) : Boolean(state.error);

  useEffect(() => {
    if (resetOnSuccess && state.ok && state.message) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <FormStateContext value={state}>
      <form
        ref={ref}
        id={id}
        action={formAction}
        className={className}
        aria-label={ariaLabel}
        onSubmit={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault();
        }}
      >
        {children}
        {!hideMessage && hasMessage ? (
          <div className="mt-4" aria-live="polite">
            <Notice tone={state.ok ? "ok" : "danger"}>{state.ok ? state.message : state.error}</Notice>
          </div>
        ) : null}
      </form>
    </FormStateContext>
  );
}

/** Compact inline variant for row actions (revoke, remove…): message appears next to the button. */
export function InlineActionForm({
  action,
  children,
  confirm,
}: {
  action: Action;
  children: ReactNode;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, { ok: true } as ActionResult);
  return (
    <form
      action={formAction}
      className="inline-flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {!state.ok ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : state.message ? (
        <span role="status" className="text-xs text-ok">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
