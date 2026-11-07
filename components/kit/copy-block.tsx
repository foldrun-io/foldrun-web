"use client";

// Commands to copy, one by one, numbered (cloudhost's CopyBlock): install,
// sign in, deploy. Each line has its own copy button.

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyBlock({ items }: { items: { label: string; value: string }[] }) {
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {items.map((it, i) => (
        <li key={it.value} className="flex min-w-0 items-center gap-3 px-4 py-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-xs tabular-nums text-fg-muted">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-fg-muted">{it.label}</p>
            <code className="block truncate font-mono text-sm text-fg" title={it.value}>
              {it.value}
            </code>
          </div>
          <CopyButton value={it.value} label={it.label} />
        </li>
      ))}
    </ol>
  );
}

/** A square copy button: the icon turns to a tick once copied. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : `Copy${label ? `: ${label}` : ""}`}
      title={done ? "Copied" : "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // the text is selectable; the button is a convenience
        }
      }}
      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line text-fg-muted transition-colors hover:bg-sunken hover:text-fg [&_svg]:size-4"
    >
      {done ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
    </button>
  );
}
