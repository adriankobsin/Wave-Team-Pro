import Link from "@/components/ui/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-ink-muted">It may have moved, or you may not have access to it in this organization.</p>
      <Link href="/" className="mt-6 font-medium underline underline-offset-4">Go to your workspace</Link>
    </main>
  );
}
