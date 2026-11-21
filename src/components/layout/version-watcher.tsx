"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
let lastCheck = 0;

/**
 * A tab left open across an update keeps talking to the old version (slow, and missing fixes).
 * When the tab comes back into view or the person moves to another page, check the live version
 * and reload once if it changed.
 */
export function VersionWatcher() {
  const pathname = usePathname();
  useEffect(() => {
    if (BUILD === "dev") return;
    const check = async () => {
      if (Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      try {
        const r = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
        const { id } = (await r.json()) as { id?: string };
        if (id && id !== "dev" && id !== BUILD) window.location.reload();
      } catch {
        // offline: try again later
      }
    };
    void check();
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [pathname]);
  return null;
}
