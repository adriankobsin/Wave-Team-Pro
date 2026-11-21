import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

/** Signs this device out only (other devices stay signed in), then shows the sign-in page. */
export function SignOutButton({ className, label = "Sign out of this device", iconOnly = false }: { className?: string; label?: string; iconOnly?: boolean }) {
  return (
    <form action="/auth/signout" method="post" className="contents">
      <button
        type="submit"
        aria-label={iconOnly ? label : undefined}
        title={label}
        className={cn("inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-panel-sunk", className)}
      >
        <LogOut className="size-4" aria-hidden />
        {iconOnly ? null : label}
      </button>
    </form>
  );
}
