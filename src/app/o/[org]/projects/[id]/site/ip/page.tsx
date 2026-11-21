import type { Metadata } from "next";
import Link from "@/components/ui/link";
import { createClient } from "@/lib/supabase/server";
import { getSiteProject } from "@/server/services/site";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "VLANs & IPs" };

export default async function IpPage({ params, searchParams }: { params: Promise<{ org: string; id: string }>; searchParams: Promise<{ vlan?: string }> }) {
  const [{ org, id }, sp] = await Promise.all([params, searchParams]);
  await getSiteProject(org, id);
  const supabase = await createClient();
  const [{ data: vlans }, { data: ips }, { data: devices }] = await Promise.all([
    supabase.from("site_vlans").select("vlan_id, name, ip_range, subnet_mask, gateway, dns, dhcp_scope, notes").eq("project_id", id).is("archived_at", null).order("vlan_id"),
    supabase.from("site_ips").select("vlan_id, address, device_name").eq("project_id", id).is("archived_at", null).limit(5000),
    supabase.from("site_devices").select("ip").eq("project_id", id).is("archived_at", null).not("ip", "is", null).limit(5000),
  ]);
  // Duplicate IPs across the device list are a classic commissioning problem: flag them.
  const seen = new Map<string, number>();
  for (const d of devices ?? []) if (/^\d+\.\d+\.\d+\.\d+$/.test(d.ip as string)) seen.set(d.ip as string, (seen.get(d.ip as string) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  const vlan = (vlans ?? []).find((v) => String(v.vlan_id) === sp.vlan) ?? (vlans ?? [])[0];
  const octet = (a: string) => Number(a.split(".").at(-1));
  const list = (ips ?? []).filter((x) => x.vlan_id === vlan?.vlan_id).sort((a, b) => octet(a.address) - octet(b.address));

  return (
    <div className="space-y-4">
      <PageHeader title="VLANs and IP addresses" description="The IP scheme from the network spreadsheet, with every address in use." />
      {dupes.length ? (
        <Panel><p className="p-4 text-sm text-danger"><strong>Duplicate IPs in the device list:</strong> {dupes.map(([ip, n]) => `${ip} (${n}×)`).join(", ")}</p></Panel>
      ) : null}
      {vlans?.length ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Panel className="h-fit">
            <ul className="divide-y divide-line text-sm">
              {vlans.map((v) => (
                <li key={v.vlan_id}><Link href={`?vlan=${v.vlan_id}`} className={cn("block px-4 py-2.5", vlan?.vlan_id === v.vlan_id ? "bg-panel-sunk font-semibold" : "hover:bg-panel-sunk")}>
                  VLAN {v.vlan_id} · {v.name}<span className="block text-xs font-normal text-ink-muted">{(ips ?? []).filter((x) => x.vlan_id === v.vlan_id).length} addresses in use</span>
                </Link></li>
              ))}
            </ul>
          </Panel>
          {vlan ? (
            <Panel className="overflow-hidden">
              <PanelHeader title={`VLAN ${vlan.vlan_id} · ${vlan.name}`} />
              <dl className="grid gap-x-4 gap-y-2 border-b border-line p-4 text-sm sm:grid-cols-3 sm:p-5">
                {([["Range", vlan.ip_range], ["Subnet mask", vlan.subnet_mask], ["Gateway", vlan.gateway], ["DNS", vlan.dns], ["DHCP scope", vlan.dhcp_scope], ["Notes", vlan.notes]] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-ink-muted">{k}</dt><dd>{v}</dd></div>)}
              </dl>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-ink-muted"><th className="px-4 py-2 font-medium">Address</th><th className="px-4 py-2 font-medium">Device</th></tr></thead>
                <tbody>{list.map((x) => <tr key={x.address} className="border-b border-line last:border-0"><td className="tabular px-4 py-1.5">{x.address}</td><td className="px-4 py-1.5">{x.device_name}</td></tr>)}</tbody>
              </table>
            </Panel>
          ) : null}
        </div>
      ) : <Panel><EmptyState title="No IP scheme yet">Import the network spreadsheet on the Site page.</EmptyState></Panel>}
    </div>
  );
}
