import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/org";

/** Part of the optional systems-integration toolkit: only for companies that have it turned on. */
export default async function ToolkitLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.settings.site_toolkit_enabled) notFound();
  return children;
}
