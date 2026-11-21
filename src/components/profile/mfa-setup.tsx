"use client";

import { useActionState, useState, useTransition } from "react";
import { removeTotpFactor, startTotpEnrollment, verifyTotpEnrollment, type EnrollResult } from "@/server/actions/mfa";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";
import { controlClass } from "@/components/ui/field";

export function MfaSetup({ factors }: { factors: { id: string; name: string | null; created_at: string }[] }) {
  const [enroll, setEnroll] = useState<EnrollResult | null>(null);
  const [starting, startTransition] = useTransition();
  const [verifyState, verify, verifying] = useActionState(verifyTotpEnrollment, { ok: true } as ActionResult);
  const [removeState, remove, removing] = useActionState(removeTotpFactor, { ok: true } as ActionResult);

  if (factors.length) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          <span className="font-medium text-ok">On.</span> You’ll be asked for a code from your authenticator app when you sign in.
        </p>
        {factors.map((f) => (
          <form key={f.id} action={remove} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
            <input type="hidden" name="factor_id" value={f.id} />
            <span className="text-sm">{f.name ?? "Authenticator app"}</span>
            <Button type="submit" variant="ghost" size="sm" disabled={removing}>Remove</Button>
          </form>
        ))}
        {!removeState.ok ? <Notice tone="danger">{removeState.error}</Notice> : removeState.message ? <Notice tone="ok">{removeState.message}</Notice> : null}
      </div>
    );
  }

  if (verifyState.ok && verifyState.message) return <Notice tone="ok">{verifyState.message} Refresh to see it listed.</Notice>;

  if (enroll?.ok && enroll.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm">Scan this code with an authenticator app (1Password, Google Authenticator, Microsoft Authenticator), then enter the 6-digit code it shows.</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- QR is an inline SVG data URI from Supabase */}
        <img src={enroll.data.qr} alt="QR code for your authenticator app" className="size-44 rounded-md bg-white p-2" />
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-muted">Can’t scan? Enter the key manually</summary>
          <code className="mt-2 block break-all rounded bg-panel-sunk p-2 text-xs">{enroll.data.secret}</code>
        </details>
        <form action={verify} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="factor_id" value={enroll.data.factorId} />
          <div>
            <label htmlFor="mfa-code" className="mb-1.5 block text-sm font-medium">Code</label>
            <input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${controlClass} w-32`} />
          </div>
          <Button type="submit" disabled={verifying}>{verifying ? "Checking…" : "Turn on"}</Button>
        </form>
        {!verifyState.ok ? <Notice tone="danger">{verifyState.error}</Notice> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">Add a second step at sign-in using an authenticator app. Required by some organizations for admin and finance work.</p>
      <Button variant="secondary" disabled={starting} onClick={() => startTransition(async () => setEnroll(await startTotpEnrollment()))}>
        {starting ? "Preparing…" : "Set up authenticator app"}
      </Button>
      {enroll && !enroll.ok ? <Notice tone="danger">{enroll.error}</Notice> : null}
    </div>
  );
}
