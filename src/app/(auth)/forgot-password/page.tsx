import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { requestPasswordReset } from "@/server/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-muted">We’ll email a link to set a new password. Invited but never signed in? This also works for finishing setup.</p>
      <ActionForm action={requestPasswordReset} className="mt-6 space-y-4" resetOnSuccess>
        <TextField label="Work email" name="email" type="email" autoComplete="email" required inputMode="email" />
        <SubmitButton className="w-full" pendingLabel="Sending…">
          Email me a link
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm">
        <Link href="/login" className="font-medium underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
