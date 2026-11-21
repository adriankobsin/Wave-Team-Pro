import Link from "@/components/ui/link";

/** GET filter form helpers shared by the site tables. */
export function Pager({ page, total, size, params }: { page: number; total: number; size: number; params: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const href = (p: number) => `?${new URLSearchParams({ ...params, page: String(p) }).toString()}`;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
      <span className="text-ink-muted">{(page - 1) * size + 1}–{Math.min(page * size, total)} of {total}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link href={href(page - 1)} className="underline">Previous</Link> : null}
        {page < pages ? <Link href={href(page + 1)} className="underline">Next</Link> : null}
      </span>
    </nav>
  );
}
