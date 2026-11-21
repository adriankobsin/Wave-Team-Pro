import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { findInvitationByToken } from "@/server/services/invitations";
import { acceptInvitationLink } from "@/server/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: `Join ${BRAND.product}`, robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Landing page for invitation links. Loading it changes nothing (email scanners that open the
 * link can't use it up); the account is set up only when the person presses the button.
 */
export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ i?: string }> }) {
  const { i } = await searchParams;
  const inv = i ? await findInvitationByToken(i) : null;
  if (!inv) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">This invitation link isn’t valid</h1>
        <p className="mt-2 text-sm text-ink-muted">It may have expired, been withdrawn, or already been used to join.</p>
        <p className="mt-4 text-sm">
          Already set up? <Link href="/login" className="font-medium underline">Sign in</Link>. Otherwise ask your administrator to send a new invitation.
        </p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold">Join {inv.org_name}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        You’ve been invited as <span className="font-medium text-ink">{inv.email}</span>
        {inv.display_name ? ` (${inv.display_name})` : ""}. Next you’ll choose your password.
      </p>
      <ActionForm action={acceptInvitationLink} className="mt-6">
        <input type="hidden" name="token" value={i} />
        <SubmitButton className="w-full" pendingLabel="Setting up…">Set up my account</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-xs text-ink-muted">Not you? Close this page; nothing changes until you press the button.</p>
    </div>
  );
}
