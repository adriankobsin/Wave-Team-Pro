import type { Metadata } from "next";
import { getOrgContext } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { signAvatarPaths } from "@/server/services/avatars";
import { updateProfile } from "@/server/actions/profile";
import { requestPasswordReset, signOutOtherSessions } from "@/server/actions/auth";
import { AvatarEditor } from "@/components/profile/avatar-editor";
import { MfaSetup } from "@/components/profile/mfa-setup";
import { ActionForm } from "@/components/ui/action-form";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { SignOutButton } from "@/components/layout/sign-out-button";

export const metadata: Metadata = { title: "My profile" };

const COMMON_ZONES = [
  "UTC", "Europe/London", "Europe/Bucharest", "Europe/Paris", "Europe/Madrid", "Europe/Monaco", "Europe/Athens",
  "Asia/Bangkok", "Asia/Singapore", "Asia/Dubai", "Asia/Hong_Kong", "Australia/Sydney",
  "America/New_York", "America/Los_Angeles", "Pacific/Auckland",
];

function zones(current: string) {
  let all: string[] = COMMON_ZONES;
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    /* older runtimes: fall back to the common list */
  }
  return Array.from(new Set(["UTC", current, ...all]));
}

async function signOutOthers() {
  "use server";
  return signOutOtherSessions();
}

export default async function ProfilePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  const supabase = await createClient();
  const [{ data: priv }, { data: factors }, urls] = await Promise.all([
    supabase.from("profile_private").select("legal_name, phone").eq("user_id", ctx.userId).maybeSingle(),
    supabase.auth.mfa.listFactors(),
    signAvatarPaths([ctx.profile.avatar_path]),
  ]);
  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified").map((f) => ({ id: f.id, name: f.friendly_name ?? null, created_at: f.created_at }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="My profile"
        description="How colleagues see you across the hub. Employment details are managed by your administrator."
        actions={<SignOutButton />}
      />

      <Panel id="photo">
        <PanelHeader title="Photo" />
        <div className="p-4 sm:p-5">
          <AvatarEditor
            userId={ctx.userId}
            name={ctx.profile.display_name}
            currentUrl={ctx.profile.avatar_path ? (urls.get(ctx.profile.avatar_path) ?? null) : null}
            hasAvatar={Boolean(ctx.profile.avatar_path)}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Details" />
        <ActionForm action={updateProfile} className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <TextField label="Preferred name" name="display_name" defaultValue={ctx.profile.display_name} required maxLength={80} autoComplete="nickname" />
          <TextField label="Work email" name="email_readonly" defaultValue={ctx.profile.email_display ?? ""} readOnly disabled hint="Ask an administrator to change your sign-in email." />
          <input type="hidden" name="locale" value={ctx.profile.locale} />
          <SelectField label="Time zone" name="timezone" defaultValue={ctx.profile.timezone}>
            {zones(ctx.profile.timezone).map((z) => (
              <option key={z} value={z}>{z.replaceAll("_", " ")}</option>
            ))}
          </SelectField>
          <TextField label="Phone" name="phone" defaultValue={priv?.phone ?? ""} optional type="tel" autoComplete="tel" hint="Only you and HR can see this." />
          <TextField label="Legal name" name="legal_readonly" defaultValue={priv?.legal_name ?? ""} readOnly disabled hint="Managed by HR." />
          <div className="sm:col-span-2">
            <SubmitButton>Save changes</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel id="security">
        <PanelHeader title="Security" />
        <div className="divide-y divide-line">
          <div className="p-4 sm:p-5">
            <h3 className="mb-3 font-semibold">Two-step verification</h3>
            <MfaSetup factors={verified} />
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
            <div>
              <h3 className="font-semibold">Password</h3>
              <p className="mb-3 text-sm text-ink-muted">We’ll email you a link to choose a new password.</p>
              <ActionForm action={requestPasswordReset}>
                <input type="hidden" name="email" value={ctx.profile.email_display ?? ""} />
                <SubmitButton variant="secondary" pendingLabel="Sending…">Email me a reset link</SubmitButton>
              </ActionForm>
            </div>
            <div>
              <h3 className="font-semibold">Other devices</h3>
              <p className="mb-3 text-sm text-ink-muted">Lost a phone? Sign out everywhere except here.</p>
              <ActionForm action={signOutOthers}>
                <SubmitButton variant="secondary" pendingLabel="Signing out…">Sign out other devices</SubmitButton>
              </ActionForm>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
