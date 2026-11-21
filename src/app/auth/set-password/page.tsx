import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/utils";
import { setPassword } from "@/server/actions/auth";
import { getSessionUser } from "@/lib/auth/session";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string; existing?: string }> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next, "/");
  const user = await getSessionUser();
  if (!user) redirect("/login?error=link");
  return (
    <div>
      <h1 className="text-2xl font-semibold">Set your password</h1>
      <p className="mt-1 text-sm text-ink-muted">
        For <span className="font-medium text-ink">{user.email}</span>. Use at least 12 characters with letters and a number. A short sentence works well.
      </p>
      <ActionForm action={setPassword} className="mt-6 space-y-4">
        <input type="hidden" name="username" autoComplete="username" value={user.email ?? ""} readOnly />
        <input type="hidden" name="next" value={next} />
        <TextField label="New password" name="password" type="password" autoComplete="new-password" required minLength={12} />
        <TextField label="Repeat password" name="confirm" type="password" autoComplete="new-password" required />
        <SubmitButton className="w-full" pendingLabel="Saving…">
          Save password and continue
        </SubmitButton>
      </ActionForm>
      {sp.existing ? (
        <p className="mt-4 text-sm text-ink-muted">
          Already have a password for {BRAND.product}? <Link href={next} className="font-medium underline">Skip and keep it</Link>.
        </p>
      ) : null}
    </div>
  );
}
