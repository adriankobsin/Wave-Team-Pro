"use client";

import { useEffect, useRef } from "react";

/** Keeps the message list scrolled to the newest message when it changes. */
export function ScrollToBottom({ marker }: { marker: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [marker]);
  return <div ref={ref} />;
}
