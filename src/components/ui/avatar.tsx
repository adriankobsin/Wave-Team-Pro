import { cn, hueFor, initials } from "@/lib/utils";

const sizes = { xs: "size-6 text-[0.625rem]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-16 text-lg", xl: "size-28 text-3xl" };

/**
 * Portrait or initials. `src` must be a short-lived signed URL produced server-side.
 * Deactivated people keep their avatar for attribution but are desaturated.
 */
export function Avatar({
  id,
  name,
  src,
  size = "md",
  inactive,
  className,
}: {
  id: string;
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  inactive?: boolean;
  className?: string;
}) {
  const hue = hueFor(id);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold",
        sizes[size],
        inactive && "grayscale opacity-70",
        className,
      )}
      style={src ? undefined : { background: `hsl(${hue} 32% 86%)`, color: `hsl(${hue} 45% 24%)` }}
      aria-hidden="true"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URLs are not cacheable by next/image
        <img src={src} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** Name + avatar, used wherever a person is attributed. */
export function PersonLabel({
  id,
  name,
  src,
  sub,
  inactive,
  size = "sm",
}: {
  id: string;
  name: string;
  src?: string | null;
  sub?: string | null;
  inactive?: boolean;
  size?: "xs" | "sm" | "md";
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <Avatar id={id} name={name} src={src} size={size} inactive={inactive} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">
          {name}
          {inactive ? <span className="ml-1.5 text-xs font-normal text-ink-muted">(former)</span> : null}
        </span>
        {sub ? <span className="block truncate text-xs text-ink-muted">{sub}</span> : null}
      </span>
    </span>
  );
}
