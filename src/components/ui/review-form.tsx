"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/errors";
import { Button } from "./button";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Approve / reject with an optional (or required-on-reject) note. */
export function ReviewForm({ action, id, rejectNeedsNote, approveLabel = "Approve", rejectLabel = "Reject" }: { action: Action; id: string; rejectNeedsNote?: boolean; approveLabel?: string; rejectLabel?: string }) {
  const [state, formAction, pending] = useActionState(action, { ok: true } as ActionResult);
  const [note, setNote] = useState("");
  if (state.ok && state.message) return <p role="status" className="text-sm text-ok">{state.message}</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`note-${id}`}>Note</label>
      <input id={`note-${id}`} name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={rejectNeedsNote ? "Note (required to reject)" : "Note (optional)"} maxLength={500} className="h-8 min-w-40 flex-1 rounded-md border border-line bg-panel px-2 text-sm" />
      <Button type="submit" name="decision" value="approve" size="sm" disabled={pending}>{approveLabel}</Button>
      <Button type="submit" name="decision" value="reject" size="sm" variant="secondary" disabled={pending || (rejectNeedsNote && !note.trim())}>{rejectLabel}</Button>
      {!state.ok ? <span role="alert" className="w-full text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}
