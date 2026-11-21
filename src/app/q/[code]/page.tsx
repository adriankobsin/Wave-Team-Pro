import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "@/components/ui/link";

export const metadata: Metadata = { title: "QR label" };

/**
 * Where a QR sticker leads: a PDF of that rack, panel, switch, drawing or project, made from the live
 * data (see ./file). Sign-in is required; this page is shown when the code can't be opened.
 */
export default async function QrPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ missing?: string }> }) {
  const { code } = await params;
  const { missing } = await searchParams;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/q/${code}`)}`);
  if (!missing && /^[a-z0-9]{8}$/.test(code)) {
    const { data: link } = await supabase.from("qr_links").select("project_id, target, organizations(slug)").eq("code", code).maybeSingle();
    const slug = (link?.organizations as unknown as { slug: string } | null)?.slug;
    if (link && slug) redirect(`/q/${code}/file`);
  }
  return (
    <main className="mx-auto max-w-md space-y-3 p-6 text-center">
      <h1 className="text-xl font-semibold">This label can&apos;t be opened</h1>
      <p className="text-sm text-ink-muted">Either the code isn&apos;t recognised, or you&apos;re not on the team for that project. Ask the project manager to add you, then scan it again.</p>
      <p><Link href="/" className="underline">Go to the group view</Link></p>
    </main>
  );
}
