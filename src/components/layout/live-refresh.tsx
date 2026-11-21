"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/browser";

/**
 * Subscribes to inserts on a table (optionally filtered) and refreshes the server-rendered
 * page when something arrives. Debounced so bursts trigger one refresh.
 */
export function LiveRefresh({ table, filter, channel }: { table: "messages" | "notifications" | "expenses" | "attendance_events"; filter?: string; channel: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = getBrowserClient();
    const sub = supabase
      .channel(channel)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 250);
      })
      .subscribe();
    // Fallback for networks that block websockets.
    const poll = setInterval(() => router.refresh(), 30_000);
    return () => {
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(sub);
    };
  }, [router, table, filter, channel]);
  return null;
}
