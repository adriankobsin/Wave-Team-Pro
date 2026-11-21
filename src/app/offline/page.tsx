import { BRAND } from "@/lib/brand";
export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">You’re offline</h1>
      <p className="mt-2 text-ink-muted">{BRAND.product} needs a connection to load your workspace. It will work again as soon as you’re back online.</p>
    </main>
  );
}
