"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const getSnapshot = () => document.documentElement.classList.contains("dark");

export function ThemeToggle({ label, className }: { label: string; className?: string }) {
  const dark = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={dark}
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("wbh-theme", next ? "dark" : "light");
        } catch {
          /* storage unavailable: theme applies for this page only */
        }
      }}
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      <span className="lg:inline">{dark ? "Light theme" : "Dark theme"}</span>
    </button>
  );
}
