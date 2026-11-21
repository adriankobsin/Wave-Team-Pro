"use client";

import { usePathname } from "next/navigation";
import Link from "@/components/ui/link";
import { cn } from "@/lib/utils";

type Item = [href: string, label: string];
const GROUPS: [string, Item[]][] = [
  ["Project", [["", "Overview"]]],
  ["Site", [["site", "Site & imports"], ["site/cables", "Cables & patch panels"], ["site/devices", "Devices"], ["site/switches", "Switches"], ["site/ip", "VLANs & IPs"], ["site/racks", "Racks"], ["site/lighting", "Lighting loads"], ["site/lutron", "Lutron integration"]]],
  ["Documents", [["drawings", "Drawings"], ["labels", "QR labels"], ["passwords", "Passwords"], ["export", "Export"]]],
];

/** Sections that belong to the optional systems-integration toolkit. */
const TOOLKIT = new Set(["drawings", "labels"]);
const isToolkit = (group: string, href: string) => group === "Site" || TOOLKIT.has(href);

/** Which item a path belongs to: the longest matching section (so /site/cables/x → Cables). */
function activeHref(path: string, base: string) {
  const rest = path.startsWith(base) ? path.slice(base.length).replace(/^\//, "") : "";
  let best = "";
  for (const [, items] of GROUPS) for (const [href] of items) if (href && (rest === href || rest.startsWith(`${href}/`)) && href.length > best.length) best = href;
  return best;
}

/**
 * The project's sections: a list down the left on computers and tablets, a strip that scrolls
 * sideways on phones. `passwords` is shown only to people allowed to see stored logins; the site
 * toolkit sections only when the company has the toolkit turned on.
 */
export function ProjectSideNav({ base, name, passwords, toolkit = true }: { base: string; name: string; passwords: boolean; toolkit?: boolean }) {
  const path = usePathname();
  const active = activeHref(path, base);
  const groups = GROUPS.map(([g, items]) => [g, items.filter(([h]) => (h !== "passwords" || passwords) && (toolkit || !isToolkit(g, h)))] as const).filter(([, items]) => items.length > 0);
  const href = (h: string) => (h ? `${base}/${h}` : base);
  return (
    <>
      <nav aria-label="Project sections" className="-mx-4 mb-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0 lg:hidden">
        <p className="pb-1 text-sm font-semibold"><Link href={base}>{name}</Link></p>
        <ul className="flex min-w-max gap-1">
          {groups.flatMap(([, items]) => items).map(([h, label]) => (
            <li key={h}>
              <Link href={href(h)} aria-current={active === h ? "page" : undefined}
                className={cn("block whitespace-nowrap border-b-2 px-3 py-2 text-sm", active === h ? "border-brass font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink")}>{label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Project sections" className="hidden lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
        <Link href={base} className="mb-4 block rounded-md px-3 text-base font-semibold leading-snug hover:underline">{name}</Link>
        {groups.map(([g, items]) => (
          <div key={g} className="mb-4">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{g}</p>
            <ul className="space-y-0.5">
              {items.map(([h, label]) => (
                <li key={h}>
                  <Link href={href(h)} aria-current={active === h ? "page" : undefined}
                    className={cn("block rounded-md border-l-2 px-3 py-1.5 text-sm", active === h ? "border-brass bg-panel font-semibold text-ink" : "border-transparent text-ink-muted hover:bg-panel hover:text-ink")}>{label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
