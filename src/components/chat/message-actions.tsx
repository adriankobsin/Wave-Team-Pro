"use client";

import { useActionState, useState } from "react";
import { deleteMessage, editMessage, toggleReaction, togglePin } from "@/server/actions/chat";
import type { ActionResult } from "@/lib/errors";

const EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "✅"] as const;
const init = { ok: true } as ActionResult;

export function ReactionBar({ messageId, conversationId, reactions }: { messageId: string; conversationId: string; reactions: { emoji: string; count: number; mine: boolean }[] }) {
  const [, action] = useActionState(toggleReaction, init);
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((r) => (
        <form key={r.emoji} action={action}>
          <input type="hidden" name="message_id" value={messageId} />
          <input type="hidden" name="conversation_id" value={conversationId} />
          <input type="hidden" name="emoji" value={r.emoji} />
          <button type="submit" aria-pressed={r.mine} className={`rounded-full border px-2 py-0.5 text-xs ${r.mine ? "border-brass bg-brass-soft" : "border-line bg-panel"}`}>
            {r.emoji} <span className="tabular">{r.count}</span>
          </button>
        </form>
      ))}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-full px-1.5 text-xs text-ink-muted opacity-70 hover:opacity-100" aria-label="Add reaction">
        ☺+
      </button>
      {open
        ? EMOJI.map((e) => (
            <form key={e} action={(fd) => { setOpen(false); action(fd); }}>
              <input type="hidden" name="message_id" value={messageId} />
              <input type="hidden" name="conversation_id" value={conversationId} />
              <input type="hidden" name="emoji" value={e} />
              <button type="submit" className="rounded px-1 text-base hover:bg-panel-sunk" aria-label={`React ${e}`}>{e}</button>
            </form>
          ))
        : null}
    </div>
  );
}

export function OwnMessageMenu({ messageId, conversationId, body, canEdit, pinned }: { messageId: string; conversationId: string; body: string; canEdit: boolean; pinned: boolean }) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction] = useActionState(async (p: ActionResult, fd: FormData) => {
    const r = await editMessage(p, fd);
    if (r.ok) setEditing(false);
    return r;
  }, init);
  const [, delAction] = useActionState(deleteMessage, init);
  const [, pinAction] = useActionState(togglePin, init);
  if (editing) {
    return (
      <form action={editAction} className="mt-1 space-y-1">
        <input type="hidden" name="message_id" value={messageId} />
        <input type="hidden" name="conversation_id" value={conversationId} />
        <label className="sr-only" htmlFor={`edit-${messageId}`}>Edit message</label>
        <textarea id={`edit-${messageId}`} name="body" defaultValue={body} className="w-full rounded border border-line bg-panel p-2 text-sm" rows={2} />
        <div className="flex gap-2 text-xs">
          <button type="submit" className="font-medium underline">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="underline">Cancel</button>
          {!editState.ok ? <span role="alert" className="text-danger">{editState.error}</span> : null}
        </div>
      </form>
    );
  }
  return (
    <div className="flex gap-3 text-xs text-ink-muted">
      {canEdit ? <button type="button" onClick={() => setEditing(true)} className="hover:underline">Edit</button> : null}
      <form action={pinAction}>
        <input type="hidden" name="message_id" value={messageId} />
        <input type="hidden" name="conversation_id" value={conversationId} />
        <input type="hidden" name="pin" value={pinned ? "0" : "1"} />
        <button type="submit" className="hover:underline">{pinned ? "Unpin" : "Pin"}</button>
      </form>
      {canEdit ? (
        <form action={delAction} onSubmit={(e) => { if (!window.confirm("Delete this message?")) e.preventDefault(); }}>
          <input type="hidden" name="message_id" value={messageId} />
          <input type="hidden" name="conversation_id" value={conversationId} />
          <button type="submit" className="hover:underline">Delete</button>
        </form>
      ) : null}
    </div>
  );
}

export function PinButton({ messageId, conversationId, pinned }: { messageId: string; conversationId: string; pinned: boolean }) {
  const [, pinAction] = useActionState(togglePin, init);
  return (
    <form action={pinAction}>
      <input type="hidden" name="message_id" value={messageId} />
      <input type="hidden" name="conversation_id" value={conversationId} />
      <input type="hidden" name="pin" value={pinned ? "0" : "1"} />
      <button type="submit" className="text-xs text-ink-muted hover:underline">{pinned ? "Unpin" : "Pin"}</button>
    </form>
  );
}
