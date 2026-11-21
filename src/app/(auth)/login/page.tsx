import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { signIn } from "@/server/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Notice } from "@/components/ui/misc";
import { getTranslator } from "@/lib/i18n";
import { safeNextPath } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import { DEMO_ACCOUNTS, demoPassword } from "@/lib/demo";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That link has expired or was already used. Request a new one below.",
  deactivated: "Your access has been removed. Contact your administrator if you think this is a mistake.",
  config: "The app isn't configured yet. An administrator needs to set the Supabase environment variables.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const t = getTranslator("en");
  const error = sp.error ? ERRORS[sp.error] : null;
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("auth.signIn")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{BRAND.demo ? "Pick a demo account below — no sign-up needed." : t("auth.inviteOnly")}</p>
      {error ? (
        <div className="mt-5">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      <ActionForm action={signIn} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={safeNextPath(sp.next, "/")} />
        <TextField label={t("auth.email")} name="email" type="email" autoComplete="username" required inputMode="email" />
        <TextField label={t("auth.password")} name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingLabel="Signing in…">
          {t("auth.signIn")}
        </SubmitButton>
      </ActionForm>
      {BRAND.demo && demoPassword() ? (
        <section aria-label="Demo accounts" className="mt-8 border-t border-line pt-6">
          <h2 className="font-semibold">Try the demo</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Sign in as one of the people at Solenne Systems, a fictional group with five companies in London, Amsterdam, Singapore, Miami and Bangkok. Everything you see is made-up demo data.
          </p>
          <ul className="mt-4 space-y-2">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <ActionForm action={signIn}>
                  <input type="hidden" name="next" value="/" />
                  <input type="hidden" name="email" value={a.email} />
                  <input type="hidden" name="password" value={demoPassword()} />
                  <button type="submit" className="w-full rounded-md border border-line bg-panel px-3 py-2.5 text-left hover:border-brass/60">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-xs font-medium text-ink-muted">{a.role}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-muted">{a.what}</span>
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">Or type any account above with the password <code className="font-mono">{demoPassword()}</code>.</p>
        </section>
      ) : null}
      <p className="mt-6 text-sm">
        <Link href="/forgot-password" className="font-medium text-ink underline underline-offset-4">
          {t("auth.forgot")}
        </Link>
      </p>
    </div>
  );
}
