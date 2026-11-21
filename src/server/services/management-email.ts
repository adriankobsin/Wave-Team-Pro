import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailButton, emailConfigured, emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { BRAND } from "@/lib/brand";

/**
 * Email copy of a management notification, for events where an admin switched email on.
 * In-app notifications are created by the database; this only adds the email.
 */
export async function emailManagement(orgId: string, event: string, subject: string, text: string, linkPath: string, excludeUserId?: string | null) {
  if (!emailConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin.rpc("management_recipients", { p_org: orgId, p_event: event });
    const to: string[] = [];
    for (const r of ((data ?? []) as { user_id: string; email: boolean }[]).filter((x) => x.email && x.user_id !== excludeUserId)) {
      const { data: u } = await admin.auth.admin.getUserById(r.user_id);
      if (u.user?.email) to.push(u.user.email);
    }
    if (!to.length) return;
    const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).single();
    await sendEmail({
      to,
      subject: `${org?.name ?? BRAND.group}: ${subject}`,
      html: emailLayout(escapeHtml(subject), `<p>${escapeHtml(text)}</p>${emailButton(`${publicEnv().APP_BASE_URL}${linkPath}`, `Open in ${BRAND.product}`)}`),
      text: `${subject}\n${text}\n${publicEnv().APP_BASE_URL}${linkPath}`,
    });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", scope: "email.management", message: (e as Error).message }));
  }
}
