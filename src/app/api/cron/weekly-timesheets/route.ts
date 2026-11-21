import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildWeekly, weeklyPdf, weeklyWorkbook } from "@/server/services/weekly";
import { emailButton, emailConfigured, emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { publicEnv } from "@/lib/env";
import { addDays, todayIn, weekStart } from "@/lib/time";
import { getLogo } from "@/server/services/branding";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs every Monday (vercel.json). For each company: last week's all-staff timesheet goes to
 * the "weekly_timesheets" recipients as an in-app notification, and by email with the Excel
 * attached when email is switched on for that event and a provider is configured.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const admin = createAdminClient();
  const base = publicEnv().APP_BASE_URL;
  const { data: orgs } = await admin.from("organizations").select("id, name, slug, timezone").eq("status", "active");
  const results: { org: string; notified: number; emailed: number }[] = [];
  for (const org of orgs ?? []) {
    const wk = weekStart(addDays(todayIn(org.timezone), -7));
    const link = `/o/${org.slug}/reports/weekly?week=${wk}`;
    const { data: recipients } = await admin.rpc("management_recipients", { p_org: org.id, p_event: "weekly_timesheets" });
    const list = (recipients ?? []) as { user_id: string; email: boolean }[];
    if (!list.length) continue;
    const data = await buildWeekly(admin, org.id, wk, org.timezone);
    const hours = data.rows.reduce((n, r) => n + r.totalLogged, 0).toFixed(2);
    const missing = data.rows.filter((r) => r.status === "none" || r.status === "draft").length;
    await admin.from("notifications").insert(list.map((r) => ({
      organization_id: org.id, user_id: r.user_id, kind: "management",
      title: `Weekly timesheets — week of ${wk}`, body: `${data.rows.length} people · ${hours} h logged · ${missing} not submitted`, link,
    })));
    let emailed = 0;
    const emailTo = list.filter((r) => r.email);
    if (emailConfigured() && emailTo.length) {
      const addresses: string[] = [];
      for (const r of emailTo) {
        const { data: u } = await admin.auth.admin.getUserById(r.user_id);
        if (u.user?.email) addresses.push(u.user.email);
      }
      const logo = await getLogo(org.id, admin);
      const [xlsx, pdf] = await Promise.all([weeklyWorkbook(org.name, wk, data, logo), weeklyPdf(org.name, wk, data, logo)]);
      const ok = await sendEmail({
        to: addresses,
        subject: `${org.name}: weekly timesheets, week of ${wk}`,
        html: emailLayout(`Weekly timesheets — ${escapeHtml(org.name)}`, `<p>Week of ${wk}: ${data.rows.length} people, ${hours} hours logged, ${missing} timesheet(s) not submitted yet.</p><p>The full sheet is attached as Excel and PDF.</p>${emailButton(`${base}${link}`, `Open in ${BRAND.product}`)}`),
        attachments: [
          { filename: `weekly-timesheets-${org.slug}-${wk}.xlsx`, content: xlsx },
          { filename: `weekly-timesheets-${org.slug}-${wk}.pdf`, content: pdf },
        ],
      });
      if (ok) emailed = addresses.length;
    }
    results.push({ org: org.slug, notified: list.length, emailed });
  }
  console.log(JSON.stringify({ level: "info", scope: "cron.weekly", results }));
  return NextResponse.json({ ok: true, results });
}
