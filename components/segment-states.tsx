"use client";

// What a money page shows while it loads, and when it could not.
//
// Billing pages read the ledger, Stripe and the plan on every render; a
// slow Stripe used to mean a blank tab, and a thrown read meant the whole
// dashboard's error screen with no way back to the page. These keep the
// frame and say which it is.

import { $rich, $t } from "@/i18n";
import { buttonVariants } from "@foldrun/ui/react/button";
import { Card } from "@foldrun/ui/react/page";

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
      <p className="sr-only" role="status">{$t("components.segment-states.loading", { label: label })}</p>
    </main>
  );
}

export function SegmentError({ label, error, retry }: { label: string; error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Card className="p-6">
        <p className="text-sm font-semibold text-fg" role="alert">
          {$t("components.segment-states.couldNotBeLoaded", { label: label })}
        </p>
        <p className="mt-1 text-sm text-fg-tertiary">
          {$t("components.segment-states.nothingWasChangedThisPageOnly")}{" "}{error.digest ? <>{$rich("components.segment-states.ifItKeepsHappeningQuote", { digest: error.digest, code: (chunks) => <code className="font-mono">{chunks}</code> })}</> : null}
        </p>
        <button onClick={() => retry()} className={`${buttonVariants({ variant: "secondary" })} mt-4`}>
          {$t("components.segment-states.tryAgain")}
        </button>
      </Card>
    </main>
  );
}
