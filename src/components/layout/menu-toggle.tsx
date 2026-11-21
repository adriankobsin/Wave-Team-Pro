"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

function set(hidden: boolean) {
  document.documentElement.classList.toggle("menu-hidden", hidden);
  try { localStorage.setItem("wbh-menu", hidden ? "hidden" : "shown"); } catch { /* storage unavailable: applies to this page only */ }
}

/** "Hide menu" at the bottom of the side menu (desktop). Remembered on this device. */
export function HideMenuButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => set(true)} title="Hide the menu for more room">
      <PanelLeftClose className="size-4" aria-hidden /> <span>Hide menu</span>
    </button>
  );
}

/** Shown top-left only while the menu is hidden (desktop). */
export function ShowMenuButton() {
  return (
    <button type="button" onClick={() => set(false)} aria-label="Show menu" title="Show menu"
      className="fixed left-3 top-3 z-30 hidden items-center lg:[.menu-hidden_&]:flex gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm font-medium text-ink shadow-sm hover:bg-panel-sunk">
      <PanelLeftOpen className="size-4" aria-hidden /> Menu
    </button>
  );
}
