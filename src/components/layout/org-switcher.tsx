import Link from "@/components/ui/link";
import { Check, ChevronsUpDown } from "lucide-react";
import type { MyOrganization } from "@/lib/types";

/** Disclosure-based switcher (works without JavaScript, keyboard accessible). */
export function OrgSwitcher({ current, orgs, label }: { current: { name: string; slug: string }; orgs: MyOrganization[]; label: string }) {
  const active = orgs.filter((o) => o.membership_status === "active" && o.organization_status === "active");
  if (active.length <= 1) {
    return (
      <div className="px-3">
        <p className="display truncate text-lg font-semibold text-hull-ink">{current.name}</p>
      </div>
    );
  }
  return (
    <details className="group relative px-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="sr-only">{label}: </span>
          <span className="display block truncate text-lg font-semibold text-hull-ink">{current.name}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-hull-muted" aria-hidden />
      </summary>
      <ul className="absolute inset-x-1 top-full z-40 mt-1 overflow-hidden rounded-md border border-line bg-panel py-1 text-ink shadow-lg">
        {active.map((o) => (
          <li key={o.organization_id}>
            <Link href={`/o/${o.slug}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-panel-sunk">
              <span className="truncate">{o.name}</span>
              {o.slug === current.slug ? <Check className="size-4 text-brass" aria-label="Current" /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
