"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", scope: "ui", digest: error.digest }));
  }, [error]);
  return (
    <main id="main" className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">This page didn’t load</h1>
      <p className="mt-2 text-ink-muted">
        Check your connection and try again. If it keeps happening, send the reference below to your administrator.
      </p>
      {error.digest ? <p className="tabular mt-3 text-sm text-ink-muted">Reference: {error.digest}</p> : null}
      <div className="mt-6">
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
