"use client";

import { useActionState, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

type Action = (prev: ActionResult<{ link: string }>, fd: FormData) => Promise<ActionResult<{ link: string }>>;

/** Generates a personal set-up link for a pending invitation and lets the admin copy it. */
export function InviteLinkButton({ action, organizationId, invitationId, email }: { action: Action; organizationId: string; invitationId: string; email: string }) {
  const [copied, setCopied] = useState(false);
  // One click: the new link goes straight to the clipboard (the Copy button stays as a fallback).
  const [state, formAction, pending] = useActionState(async (prev: ActionResult<{ link: string }>, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok && r.data?.link) {
      try {
        await navigator.clipboard.writeText(r.data.link);
        setCopied(true);
      } catch {
        // Clipboard blocked: the link is shown with a Copy button.
      }
    }
    return r;
  }, { ok: true } as ActionResult<{ link: string }>);
  const link = state.ok ? state.data?.link : undefined;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }


  return (
    <div className="w-full sm:w-auto">
      {link ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-[28rem]">
          <input readOnly value={link} aria-label={`Set-up link for ${email}`} onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel-sunk px-2 text-xs" />
          <Button type="button" size="sm" onClick={copy}><Copy className="size-3.5" aria-hidden />{copied ? "Copied" : "Copy"}</Button>
          <a className="text-xs underline" href={`mailto:${email}?subject=${encodeURIComponent(`Your ${BRAND.product} invitation`)}&body=${encodeURIComponent(`Hi,\n\nPlease set up your ${BRAND.product} account here:\n${link}\n\nThanks`)}`}>Email it</a>
          <a className="text-xs underline" href={`https://wa.me/?text=${encodeURIComponent(`Your ${BRAND.product} invitation: ${link}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="organization_id" value={organizationId} />
          <input type="hidden" name="invitation_id" value={invitationId} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}><Link2 className="size-3.5" aria-hidden />{pending ? "Creating…" : "Copy link"}</Button>
          {!state.ok ? <span role="alert" className="ml-2 text-xs text-danger">{state.error}</span> : null}
        </form>
      )}
    </div>
  );
}
