"use client";

import { Languages } from "lucide-react";
import { UI_LANGUAGES, LANG_COOKIE, type UiLang } from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";

/** Top-bar language choice. Stored in a cookie for a year; the page reloads in the new language. */
export function LanguagePicker({ current, className, compact }: { current: UiLang; className?: string; compact?: boolean }) {
  return (
    <label className={cn("inline-flex items-center gap-1.5 text-sm", className)} data-no-translate>
      <Languages className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">Language</span>
      <select
        value={current}
        aria-label="Language"
        className={cn("cursor-pointer rounded-md border border-current/20 bg-transparent py-1 pl-1.5 pr-6 text-sm", compact && "w-[4.5rem]")}
        onChange={(e) => {
          const v = e.target.value;
          document.cookie = `${LANG_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
          try { localStorage.setItem(LANG_COOKIE, v); } catch { /* cookie is enough */ }
          window.location.reload();
        }}
      >
        {UI_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{compact ? l.short : l.name}</option>)}
      </select>
    </label>
  );
}
