import "server-only";
import { BRAND } from "@/lib/brand";

export type EmailAttachment = { filename: string; content: Buffer };

/** True when an email provider is configured (Resend: EMAIL_PROVIDER_API_KEY + EMAIL_FROM). */
export function emailConfigured() {
  return Boolean(process.env.EMAIL_PROVIDER_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Simple branded layout for transactional email. All dynamic text must be escaped by the caller. */
export function emailLayout(title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#eef2f1;font-family:Arial,Helvetica,sans-serif;color:#0e2a3b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px" cellpadding="0" cellspacing="0">
<tr><td style="background:#0e2a3b;color:#ffffff;padding:16px 24px;border-radius:8px 8px 0 0;font-size:14px">${escapeHtml(BRAND.product)}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${title}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

export function emailButton(href: string, label: string) {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#b98a3c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:bold">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#556770">If the button doesn't work, copy this address into your browser:<br>${escapeHtml(href)}</p>`;
}

/** Sends through Resend's REST API. Returns false (and logs) instead of throwing. */
export async function sendEmail(msg: { to: string[]; subject: string; html: string; text?: string; attachments?: EmailAttachment[] }): Promise<boolean> {
  if (!emailConfigured() || !msg.to.length) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM!.trim(),
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
      }),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ level: "error", scope: "email.send", status: res.status }));
      return false;
    }
    return true;
  } catch (e) {
    console.error(JSON.stringify({ level: "error", scope: "email.send", message: (e as Error).message }));
    return false;
  }
}
