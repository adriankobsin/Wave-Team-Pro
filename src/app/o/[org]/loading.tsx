export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-56 animate-pulse rounded bg-line/60" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded bg-line/40" />
      <div className="mt-6 h-64 animate-pulse rounded-lg bg-line/30" />
    </div>
  );
}
