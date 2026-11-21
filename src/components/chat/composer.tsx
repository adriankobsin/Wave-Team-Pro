"use client";

import { useActionState, useRef, useState } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { sendMessage } from "@/server/actions/chat";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui/button";

export function Composer({ orgId, conversationId, placeholder }: { orgId: string; conversationId: string; placeholder: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [state, action, pending] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const result = await sendMessage(prev, fd);
    if (result.ok) {
      formRef.current?.reset();
      setFiles([]);
      textRef.current?.focus();
    }
    return result;
  }, { ok: true } as ActionResult);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        fd.delete("files");
        for (const f of files) fd.append("files", f);
        action(fd);
      }}
      className="border-t border-line bg-panel p-3"
    >
      <input type="hidden" name="organization_id" value={orgId} />
      <input type="hidden" name="conversation_id" value={conversationId} />
      {files.length ? (
        <ul className="mb-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-1 rounded border border-line bg-panel-sunk px-2 py-1 text-xs">
              <span className="max-w-40 truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,.pptx,.txt,.csv"
          onChange={(e) => {
            setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 5));
            e.target.value = "";
          }}
        />
        <Button variant="ghost" size="md" aria-label="Attach files" onClick={() => fileRef.current?.click()} className="px-2.5">
          <Paperclip className="size-5" aria-hidden />
        </Button>
        <label htmlFor="composer-body" className="sr-only">Message</label>
        <textarea
          ref={textRef}
          id="composer-body"
          name="body"
          rows={1}
          maxLength={8000}
          placeholder={placeholder}
          className="max-h-40 min-h-10 flex-1 resize-y rounded-md border border-line bg-panel px-3 py-2 text-[0.9375rem] focus:border-brass focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <Button type="submit" disabled={pending} aria-label="Send">
          <Send className="size-4" aria-hidden />
          <span className="hidden sm:inline">{pending ? "Sending…" : "Send"}</span>
        </Button>
      </div>
      {!state.ok ? <p role="alert" className="mt-2 text-xs text-danger">{state.error}</p> : null}
      <p className="mt-1 hidden text-xs text-ink-muted sm:block">Enter to send, Shift+Enter for a new line. Type @name to mention someone.</p>
    </form>
  );
}
