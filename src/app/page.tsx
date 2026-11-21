import { redirect } from "next/navigation";
import { getMyOrganizations, requireActiveProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getHub } from "@/server/services/hub";

/** Routes a signed-in person to the right place: their workspace, onboarding, or provisioning. */
export default async function Root() {
  await requireActiveProfile();
  const orgs = (await getMyOrganizations()).filter((o) => o.membership_status === "active" && o.organization_status === "active");
  // People who run several companies land on Group Hub, the whole group in one place.
  if (orgs.length && (await getHub())) redirect("/hub");
  const supabase = await createClient();
  const { data: pending } = await supabase.rpc("list_my_pending_invitations");
  if (orgs.length === 1 && !(pending?.length)) redirect(`/o/${orgs[0].slug}`);
  if (orgs.length === 0 && !(pending?.length)) {
    const { data: isPlatform } = await supabase.rpc("is_platform_admin");
    if (isPlatform) redirect("/platform");
  }
  redirect("/onboarding");
}
