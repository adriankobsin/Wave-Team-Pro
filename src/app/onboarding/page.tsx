import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { getMyOrganizations, requireActiveProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { acceptInvitation } from "@/server/actions/onboarding";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { AuthFrame } from "@/components/layout/auth-frame";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Your workspaces" };

type Pending = {
  invitation_id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role_name: string;
  job_title: string | null;
  invited_by_name: string | null;
  expires_at: string;
};

export default async function OnboardingPage() {
  const { profile } = await requireActiveProfile();
  const supabase = await createClient();
  const [{ data: pendingRaw }, orgs, { data: isPlatform }] = await Promise.all([
    supabase.rpc("list_my_pending_invitations"),
    getMyOrganizations(),
    supabase.rpc("is_platform_admin"),
  ]);
  const pending = (pendingRaw as Pending[] | null) ?? [];
  const active = orgs.filter((o) => o.membership_status === "active" && o.organization_status === "active");
  const ended = orgs.filter((o) => o.membership_status !== "active");

  return (
    <AuthFrame>
      <h1 className="text-2xl font-semibold">Hello, {profile.display_name}</h1>

      {pending.length ? (
        <section className="mt-6" aria-labelledby="inv-h">
          <h2 id="inv-h" className="text-base font-semibold">Invitations</h2>
          <ul className="mt-3 space-y-3">
            {pending.map((p) => (
              <li key={p.invitation_id} className="rounded-lg border border-line bg-panel p-4">
                <p className="font-semibold">{p.organization_name}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {p.job_title ? `${p.job_title}, ` : ""}
                  {p.role_name}
                  {p.invited_by_name ? ` — invited by ${p.invited_by_name}` : ""}. Valid until {formatDate(p.expires_at, profile.timezone)}.
                </p>
                <ActionForm action={acceptInvitation} className="mt-3">
                  <input type="hidden" name="invitation_id" value={p.invitation_id} />
                  <input type="hidden" name="organization_slug" value={p.organization_slug} />
                  <SubmitButton pendingLabel="Joining…">Join {p.organization_name}</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {active.length ? (
        <section className="mt-8" aria-labelledby="orgs-h">
          <h2 id="orgs-h" className="text-base font-semibold">Your workspaces</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {active.map((o) => (
              <li key={o.organization_id}>
                <Link href={`/o/${o.slug}`} className="block px-4 py-3 font-medium hover:bg-panel-sunk">
                  {o.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!pending.length && !active.length ? (
        <p className="mt-4 text-sm text-ink-muted">
          You’re signed in, but you aren’t a member of any workspace yet. Ask your administrator to send an invitation to{" "}
          <span className="font-medium text-ink">{profile.email_display}</span>.
        </p>
      ) : null}

      {ended.length ? (
        <p className="mt-6 text-xs text-ink-muted">Access ended: {ended.map((o) => o.name).join(", ")}.</p>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        {isPlatform ? (
          <Link href="/platform" className="font-medium underline underline-offset-4">
            Provision organizations
          </Link>
        ) : null}
        <form action="/auth/signout" method="post">
          <button type="submit" className="underline underline-offset-4">Sign out</button>
        </form>
      </div>
    </AuthFrame>
  );
}
