"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import Link from "@/components/ui/link";
import { BRAND } from "@/lib/brand";

/**
 * "Back" on every page below the main one: returns to the previous page, or to the page above
 * when there's no history (opened from a link). Group Hub users also get a way home.
 */
export function BackBar({ home, hubHome }: { home: string; hubHome?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === home || pathname === `${home}/`) return null;
  const parent = pathname.split("/").slice(0, -1).join("/") || home;
  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1 && document.referrer.startsWith(window.location.origin)) router.back();
    else router.push(parent.length >= home.length ? parent : home);
  };
  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 font-medium hover:bg-panel-sunk">
        <ArrowLeft className="size-4" aria-hidden /> Back
      </button>
      {hubHome ? (
        <Link href="/hub" className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-ink-muted hover:bg-panel-sunk hover:text-ink">
          <LayoutGrid className="size-4" aria-hidden /> {BRAND.hub}
        </Link>
      ) : (
        <Link href={home} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-ink-muted hover:bg-panel-sunk hover:text-ink">Home</Link>
      )}
    </div>
  );
}
