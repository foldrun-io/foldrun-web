"use client";

// What a money page shows while it loads, and when it could not.
//
// Billing pages read the ledger, Stripe and the plan on every render; a
// slow Stripe used to mean a blank tab, and a thrown read meant the whole
// dashboard's error screen with no way back to the page. These keep the
// frame and say which it is.

import { buttonClass, Card } from "./ui";

export function SegmentLoading({ label }: { label: string }) {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8" aria-busy="true">
      <div className="mb-6 h-7 w-40 animate-pulse rounded bg-muted" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-muted" />
      <p className="sr-only" role="status">Loading {label}…</p>
    </main>
  );
}

export function SegmentError({ label, error, retry }: { label: string; error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Card className="p-6">
        <p className="text-sm font-semibold text-fg" role="alert">
          {label} could not be loaded.
        </p>
        <p className="mt-1 text-sm text-fg-tertiary">
          Nothing was changed — this page only reads. {error.digest ? <>If it keeps happening, quote <code className="font-mono">{error.digest}</code>.</> : null}
        </p>
        <button onClick={() => retry()} className={`${buttonClass("secondary")} mt-4`}>
          Try again
        </button>
      </Card>
    </main>
  );
}
