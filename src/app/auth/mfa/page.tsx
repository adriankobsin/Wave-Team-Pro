import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { verifyMfaStepUp } from "@/server/actions/mfa";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { safeNextPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const next = safeNextPath((await searchParams).next, "/");
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasTotp = (factors?.totp?.length ?? 0) > 0;
  return (
    <div>
      <h1 className="text-2xl font-semibold">Two-step verification</h1>
      {hasTotp ? (
        <>
          <p className="mt-1 text-sm text-ink-muted">Enter the 6-digit code from your authenticator app.</p>
          <ActionForm action={verifyMfaStepUp} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={next} />
            <TextField label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
            <SubmitButton className="w-full" pendingLabel="Checking…">
              Verify
            </SubmitButton>
          </ActionForm>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          You haven’t set up an authenticator yet. Open your profile, go to Security and add one, then return here.
        </p>
      )}
      <p className="mt-6 text-sm">
        <Link href={next} className="underline underline-offset-4">
          Not now
        </Link>
      </p>
    </div>
  );
}
